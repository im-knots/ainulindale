import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { axialToPixel, HEX_SIZE } from './math';
import { AppState, Store, Entity, ENTITY_COLORS, ToolEntity } from '../state/store';
import { STATUS_VISUALS, GLOW, COLORS_HEX } from '../styles/tokens';
import { getAdjacentEntities, getResourcesInRange } from './adjacency';
import { getZoneVisualizationData, ZONE_COLORS, getDirectionFromTo, getZonePermissions, getEntityRBACConfig } from '../rbac/permissions';

// Provider logo mapping
const PROVIDER_LOGOS: Record<string, string> = {
  openai: '/logos/providers/openai-icon.png',
  anthropic: '/logos/providers/anthropic-icon.png',
  deepseek: '/logos/providers/deepseek-icon.png',
  gemini: '/logos/providers/google-gemini-icon.png',
  cohere: '/logos/providers/cohere-icon.png',
  mistral: '/logos/providers/mistral-icon.png',
  ollama: '/logos/providers/ollama-icon.png',
  grok: '/logos/providers/xai-icon.png',
};
import { ZonePattern, ZONE_PATTERNS } from '../rbac/types';

// Get all zone patterns from the type definitions - these ARE the defaults
const ZONE_PATTERN_CYCLE: ZonePattern[] = Object.keys(ZONE_PATTERNS) as ZonePattern[];

const HEX_BASE_HEIGHT = 0.5;
const SELECTION_LIFT = 8; // How high selected entities lift
const BREATHE_AMPLITUDE = 0.15; // Glow amplitude for breathing

// Token-based height scaling constants
const MAX_HEX_HEIGHT_GROWTH = 4.0; // Maximum additional height from tokens (so max total = BASE + 4)
const TOKEN_SCALE_FACTOR = 10000; // Tokens at which we're at ~63% of max growth (logarithmic reference)
const TOKEN_WARNING_THRESHOLD = 0.7; // Start turning red at 70% of max height
const TOKEN_DANGER_THRESHOLD = 0.9; // Full red at 90% of max height
const WARNING_COLOR = 0xef4444; // Red color for high token usage

// Agent template colors (sub-types within agent category)
const AGENT_TEMPLATE_COLORS: Record<string, number> = {
  planner: 0x6366f1,   // indigo
  coder: 0x22c55e,     // green
  reviewer: 0xf59e0b,  // amber
  researcher: 0x3b82f6, // blue
};

/**
 * Calculate hex height based on accumulated tokens using logarithmic scaling.
 * Height grows quickly at first, then slows as it approaches the maximum.
 * @param tokens - Accumulated token count for the entity
 * @returns Height value that asymptotically approaches MAX_HEX_HEIGHT_GROWTH
 */
function calculateTokenBasedHeight(tokens: number): number {
  if (tokens <= 0) return 0;
  // Logarithmic scaling: grows quickly at first, then slows
  // log(1 + x) / log(1 + ref) gives us a value that approaches 1 as x approaches infinity
  // We scale this to MAX_HEX_HEIGHT_GROWTH
  const normalizedGrowth = Math.log(1 + tokens / TOKEN_SCALE_FACTOR);
  // Cap at a reasonable value to prevent infinite growth
  const cappedGrowth = Math.min(normalizedGrowth, 3); // log(1 + 100000/10000) ~ 2.4, so 3 gives good headroom
  return (cappedGrowth / 3) * MAX_HEX_HEIGHT_GROWTH;
}

/**
 * Calculate the height ratio (0-1) for color interpolation.
 * Returns how close the hex is to its maximum height.
 */
function calculateHeightRatio(tokens: number): number {
  const growth = calculateTokenBasedHeight(tokens);
  return growth / MAX_HEX_HEIGHT_GROWTH;
}

/**
 * Interpolate between two colors based on a ratio.
 * @param color1 - Starting color (hex number)
 * @param color2 - Ending color (hex number)
 * @param ratio - Interpolation ratio (0-1)
 * @returns Interpolated color as hex number
 */
function interpolateColor(color1: number, color2: number, ratio: number): number {
  const r1 = (color1 >> 16) & 0xff;
  const g1 = (color1 >> 8) & 0xff;
  const b1 = color1 & 0xff;

  const r2 = (color2 >> 16) & 0xff;
  const g2 = (color2 >> 8) & 0xff;
  const b2 = color2 & 0xff;

  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);

  return (r << 16) | (g << 8) | b;
}

/**
 * Get the hex color based on token usage, interpolating to red as usage increases.
 * @param baseColor - The entity's normal color
 * @param tokens - Accumulated tokens
 * @returns Color that may be shifted toward red based on token usage
 */
function getTokenWarningColor(baseColor: number, tokens: number): number {
  const heightRatio = calculateHeightRatio(tokens);

  if (heightRatio < TOKEN_WARNING_THRESHOLD) {
    return baseColor; // No warning yet
  }

  // Calculate how far into the warning zone we are (0-1)
  const warningProgress = (heightRatio - TOKEN_WARNING_THRESHOLD) / (TOKEN_DANGER_THRESHOLD - TOKEN_WARNING_THRESHOLD);
  const clampedProgress = Math.min(1, Math.max(0, warningProgress));

  return interpolateColor(baseColor, WARNING_COLOR, clampedProgress);
}

// Connection metadata for glow effects
interface ConnectionInfo {
  agentHexKey: string;
  toolHexKey: string;
  hasRead: boolean;
  hasWrite: boolean;
  color: number;
  line: THREE.Mesh;
  glowLine: THREE.Mesh;
}

export class Renderer3D {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private store: Store;
  private hexMeshes: Map<string, THREE.Mesh> = new Map();
  private hexEdges: Map<string, THREE.LineSegments> = new Map();
  private entityModels: Map<string, THREE.Group> = new Map();
  private connectionLines: THREE.Group;
  private adjacencyLinks: THREE.Group;
  private rangeHighlights: Map<string, THREE.LineSegments> = new Map(); // For range glow effect
  private connectionInfos: Map<string, ConnectionInfo> = new Map(); // Track connections for glow effects
  private activeFlows: Map<string, number> = new Map(); // pairKey -> timestamp of last flow

  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private container: HTMLElement;
  private lastTime: number = 0;
  private animationFrameId: number | undefined;
  private boundHandleResize: () => void;
  private boundHandleClick: (e: MouseEvent) => void;
  private boundHandleContextMenu: (e: MouseEvent) => void;

  // Texture loader and cache for provider logos
  private textureLoader: THREE.TextureLoader = new THREE.TextureLoader();
  private textureCache: Map<string, THREE.Texture> = new Map();

  constructor(container: HTMLElement, store: Store) {
    this.container = container;
    this.store = store;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Bind event handlers for proper cleanup later
    this.boundHandleResize = () => this.handleResize();
    this.boundHandleClick = (e: MouseEvent) => this.handleClick(e);
    this.boundHandleContextMenu = (e: MouseEvent) => this.handleContextMenu(e);

    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS_HEX.bgPrimary);

    // Camera
    const aspect = container.clientWidth / container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
    this.camera.position.set(0, 400, 300);
    this.camera.lookAt(0, 0, 0);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2.2;
    this.controls.minDistance = 100;
    this.controls.maxDistance = 800;

    // Connection lines group
    this.connectionLines = new THREE.Group();
    this.scene.add(this.connectionLines);

    // Adjacency links group (shows resource sharing)
    this.adjacencyLinks = new THREE.Group();
    this.scene.add(this.adjacencyLinks);

    this.setupLighting();
    this.setupEventListeners();
    this.animate();
  }

  private setupLighting(): void {
    // Ambient light (increased intensity for better visibility)
    const ambient = new THREE.AmbientLight(0x505070, 0.6);
    this.scene.add(ambient);

    // Main directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(100, 200, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 10;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -300;
    dirLight.shadow.camera.right = 300;
    dirLight.shadow.camera.top = 300;
    dirLight.shadow.camera.bottom = -300;
    this.scene.add(dirLight);

    // Accent light from below for glow effect
    const accentLight = new THREE.PointLight(0x6366f1, 0.3, 500);
    accentLight.position.set(0, -50, 0);
    this.scene.add(accentLight);
  }

  private setupEventListeners(): void {
    window.addEventListener('resize', this.boundHandleResize);
    this.renderer.domElement.addEventListener('click', this.boundHandleClick);
    this.renderer.domElement.addEventListener('contextmenu', this.boundHandleContextMenu);
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check hexes first
    const hexMeshes = Array.from(this.hexMeshes.values());
    const hexIntersects = this.raycaster.intersectObjects(hexMeshes);

    // Also check entity models (they sit on top of hexes and can block clicks)
    const entityModels = Array.from(this.entityModels.values());
    const entityIntersects = this.raycaster.intersectObjects(entityModels, true); // recursive = true

    // Combine and sort by distance to find closest hit
    const allIntersects = [...hexIntersects, ...entityIntersects].sort((a, b) => a.distance - b.distance);

    if (allIntersects.length > 0) {
      const hit = allIntersects[0].object;
      const hexKey = hit.userData.hexKey;
      if (hexKey) {
        this.store.selectHex(hexKey);
      }
    } else {
      this.store.selectHex(null);
    }
  }

  /**
   * Handle right-click on tool hexes to cycle zone patterns
   * User must right-click directly on the selected tool hex
   */
  private handleContextMenu(event: MouseEvent): void {
    console.log('[Renderer3D] Context menu event triggered');

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check hexes and entity models
    const hexMeshes = Array.from(this.hexMeshes.values());
    const hexIntersects = this.raycaster.intersectObjects(hexMeshes);
    const entityModels = Array.from(this.entityModels.values());
    const entityIntersects = this.raycaster.intersectObjects(entityModels, true);
    const allIntersects = [...hexIntersects, ...entityIntersects].sort((a, b) => a.distance - b.distance);

    if (allIntersects.length === 0) {
      console.log('[Renderer3D] No intersects found');
      return;
    }

    const hit = allIntersects[0].object;
    // Walk up the parent chain to find hexKey (entity models are nested)
    let hexKey = hit.userData.hexKey;
    let current: THREE.Object3D | null = hit;
    while (!hexKey && current.parent) {
      current = current.parent;
      hexKey = current.userData?.hexKey;
    }

    if (!hexKey) {
      console.log('[Renderer3D] No hexKey found on hit object');
      return;
    }

    console.log('[Renderer3D] Right-clicked on hex:', hexKey);

    const state = this.store.getState();
    const hex = state.hexes.get(hexKey);
    if (!hex?.entityId) {
      console.log('[Renderer3D] Hex has no entity');
      return;
    }

    const entity = state.entities.get(hex.entityId);
    if (!entity) {
      console.log('[Renderer3D] Entity not found');
      return;
    }

    if (entity.category !== 'tool') {
      console.log('[Renderer3D] Entity is not a tool:', entity.category);
      return;
    }

    // Prevent default context menu for tool hexes
    event.preventDefault();

    const toolEntity = entity as ToolEntity;
    const currentConfig = toolEntity.rbacConfig;
    if (!currentConfig) {
      console.log('[Renderer3D] Tool has no RBAC config');
      return;
    }

    console.log('[Renderer3D] Current RBAC config:', JSON.stringify(currentConfig.zoneConfig));

    // Find current zone pattern by matching zone config
    const currentZoneConfig = currentConfig.zoneConfig;
    let currentPatternIndex = -1;

    for (let i = 0; i < ZONE_PATTERN_CYCLE.length; i++) {
      const pattern = ZONE_PATTERNS[ZONE_PATTERN_CYCLE[i]];
      // Use spread to avoid mutating the original arrays with sort()
      if (
        JSON.stringify([...pattern.readZone].sort()) === JSON.stringify([...currentZoneConfig.readZone].sort()) &&
        JSON.stringify([...pattern.writeZone].sort()) === JSON.stringify([...currentZoneConfig.writeZone].sort()) &&
        JSON.stringify([...pattern.readWriteZone].sort()) === JSON.stringify([...currentZoneConfig.readWriteZone].sort())
      ) {
        currentPatternIndex = i;
        break;
      }
    }

    console.log('[Renderer3D] Current pattern index:', currentPatternIndex);

    // Cycle to next pattern
    const nextPatternIndex = (currentPatternIndex + 1) % ZONE_PATTERN_CYCLE.length;
    const nextPattern = ZONE_PATTERN_CYCLE[nextPatternIndex];
    const nextZoneConfig = ZONE_PATTERNS[nextPattern];

    console.log('[Renderer3D] Cycling to pattern:', nextPattern);

    // Update the entity's RBAC config
    this.store.updateEntity(toolEntity.id, {
      rbacConfig: {
        ...currentConfig,
        zoneConfig: nextZoneConfig,
      },
    });

    console.log(`[Renderer3D] Cycled zone pattern for ${toolEntity.name}: ${nextPattern}`);
  }

  private createHexGeometry(height: number): THREE.BufferGeometry {
    const shape = new THREE.Shape();
    const size = HEX_SIZE * 0.95;
    
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const x = size * Math.cos(angle);
      const y = size * Math.sin(angle);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();

    const extrudeSettings = {
      depth: height,
      bevelEnabled: true,
      bevelThickness: 2,
      bevelSize: 2,
      bevelSegments: 2,
    };

    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }

  render(state: AppState): void {
    console.log('[Renderer3D] render() called - hexes:', state.hexes.size, 'entities:', state.entities.size);

    // Debug: log all hexes with entities
    const hexesWithEntities: string[] = [];
    state.hexes.forEach((hex, key) => {
      if (hex.entityId) {
        hexesWithEntities.push(`${key}:${hex.entityId}`);
      }
    });
    console.log('[Renderer3D] Hexes with entities:', hexesWithEntities.join(', ') || 'none');

    // Clear old meshes and edges
    this.hexMeshes.forEach(mesh => this.scene.remove(mesh));
    this.hexMeshes.clear();
    this.hexEdges.forEach(edge => this.scene.remove(edge));
    this.hexEdges.clear();
    this.entityModels.forEach(model => this.scene.remove(model));
    this.entityModels.clear();
    this.connectionLines.clear();

    // Create hex meshes
    let entitiesFound = 0;
    let entitiesWithModels = 0;
    state.hexes.forEach((hex, key) => {
      const hasEntity = !!hex.entityId;
      const isSelected = state.selectedHex === key;
      const entity = hasEntity ? state.entities.get(hex.entityId!) : null;

      if (hasEntity) {
        entitiesFound++;
        if (entity) {
          entitiesWithModels++;
        } else {
          console.warn('[Renderer3D] Hex has entityId but entity not found:', key, 'entityId:', hex.entityId);
        }
      }

      // Height based on run tokens - entities start at base height and grow as tokens accrue per run
      let height = HEX_BASE_HEIGHT; // All hexes start at base height
      let runTokens = 0;
      if (entity) {
        runTokens = entity.metrics?.runTokens || 0;
        // Entities start at base height and grow from token usage during this run
        height = HEX_BASE_HEIGHT + calculateTokenBasedHeight(runTokens);
      }

      const geometry = this.createHexGeometry(height * 10);

      // Material based on state - using design tokens for lighter base colors
      let color: number = COLORS_HEX.hexEmpty;
      let emissive: number = COLORS_HEX.hexEmptyEmissive;
      let emissiveIntensity = 0.15;

      // Edge glow color
      let edgeColor: number = COLORS_HEX.hexEdge;

      if (entity) {
        const entityColor = ENTITY_COLORS[entity.category];
        // Apply token warning color - shifts toward red as tokens increase during this run
        const warningAdjustedColor = getTokenWarningColor(entityColor, runTokens);
        color = this.darkenColor(warningAdjustedColor, 0.3);
        emissive = warningAdjustedColor;
        emissiveIntensity = 0.3;
        edgeColor = warningAdjustedColor;
      }
      if (isSelected) {
        color = COLORS_HEX.hexSelected;
        emissive = 0x0088ff;
        emissiveIntensity = 0.6;
        edgeColor = 0x00aaff;
      }

      const material = new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity,
        metalness: 0.3,
        roughness: 0.7,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Position - convert axial to world coords
      const pos = axialToPixel(hex.coord);
      mesh.position.set(pos.x, 0, pos.y);
      mesh.rotation.x = -Math.PI / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.hexKey = key;

      this.scene.add(mesh);
      this.hexMeshes.set(key, mesh);

      // Add glowing edges
      const edges = new THREE.EdgesGeometry(geometry, 30);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: edgeColor,
        transparent: true,
        opacity: isSelected ? 1.0 : hasEntity ? 0.8 : 0.4,
      });
      const edgeLines = new THREE.LineSegments(edges, edgeMaterial);
      edgeLines.position.copy(mesh.position);
      edgeLines.rotation.copy(mesh.rotation);

      this.scene.add(edgeLines);
      this.hexEdges.set(key, edgeLines);

      // Add outer glow for selected hex
      if (isSelected) {
        // Create a slightly larger hex for the glow effect
        const glowGeometry = this.createHexGeometry(height * 10 + 2);
        const glowEdges = new THREE.EdgesGeometry(glowGeometry, 30);
        const glowMaterial = new THREE.LineBasicMaterial({
          color: 0x00aaff,
          transparent: true,
          opacity: 0.6,
        });
        const glowLines = new THREE.LineSegments(glowEdges, glowMaterial);
        glowLines.position.copy(mesh.position);
        glowLines.position.y -= 0.5; // Slight offset
        glowLines.rotation.copy(mesh.rotation);
        this.scene.add(glowLines);
        this.hexEdges.set(key + '-glow', glowLines);

        // Add second glow layer for more bloom
        const glowGeometry2 = this.createHexGeometry(height * 10 + 4);
        const glowEdges2 = new THREE.EdgesGeometry(glowGeometry2, 30);
        const glowMaterial2 = new THREE.LineBasicMaterial({
          color: 0x0088ff,
          transparent: true,
          opacity: 0.3,
        });
        const glowLines2 = new THREE.LineSegments(glowEdges2, glowMaterial2);
        glowLines2.position.copy(mesh.position);
        glowLines2.position.y -= 1;
        glowLines2.rotation.copy(mesh.rotation);
        this.scene.add(glowLines2);
        this.hexEdges.set(key + '-glow2', glowLines2);
      }

      // Add entity model if this hex has an entity
      if (entity) {
        const model = this.createEntityModel(entity);
        const hexHeight = height * 10;
        model.position.set(pos.x, hexHeight + 2, pos.y);
        model.userData.hexKey = key; // Store hex key for click detection

        // Add provider badge to agent model BEFORE adding to scene
        if (entity.category === 'agent') {
          const agentEntity = entity as import('../state/store').AgentEntity;
          if (agentEntity.provider) {
            const badge = this.createProviderBadge(agentEntity.provider);
            if (badge) {
              // Position badge at chest level (body is at y=14, height=16)
              // Place it in front (positive Z in local space)
              badge.position.set(0, 15, 18); // Chest level, in front
              model.add(badge); // Add as child of agent model
            }
          }
        }

        // Also set hexKey on all children for recursive raycast detection
        model.traverse((child) => {
          child.userData.hexKey = key;
        });
        this.scene.add(model);
        this.entityModels.set(key, model);

        // Add utilization ring if entity has metrics
        if (entity.metrics?.utilization !== undefined) {
          const ring = this.createUtilizationRing(entity.metrics.utilization);
          ring.position.set(pos.x, hexHeight + 1, pos.y);
          this.scene.add(ring);
          this.entityModels.set(key + '-util-ring', ring as unknown as THREE.Group);
        }

        // Add capability indicators for agents
        if (entity.category === 'agent') {
          const agentEntity = entity as import('../state/store').AgentEntity;
          const adjacentEntities = getAdjacentEntities(key, state);
          const toolTypes = new Set<string>();

          for (const adj of adjacentEntities) {
            if (adj.category === 'tool') {
              const toolEntity = adj as import('../state/store').ToolEntity;
              toolTypes.add(toolEntity.toolType);
            }
          }

          if (toolTypes.size > 0) {
            const indicators = this.createCapabilityIndicators(Array.from(toolTypes));
            indicators.position.set(pos.x, hexHeight + 25, pos.y);
            this.scene.add(indicators);
            this.entityModels.set(key + '-capabilities', indicators);
          }

          // Add rulefile indicator if agent has equipped rulefiles
          const equippedRulefiles = agentEntity.equippedRulefiles || [];
          const enabledRulefiles = equippedRulefiles.filter(eq => eq.enabled);
          if (enabledRulefiles.length > 0) {
            const rulefileIndicator = this.createRulefileIndicator(enabledRulefiles.length);
            // Position on right side at chest level (positive X in local space)
            // Provider badge is at (0, 15, 18) for front/chest
            // Rulefile indicator at (18, 15, 0) for right side at chest level
            rulefileIndicator.position.set(18, 15, 0);
            model.add(rulefileIndicator); // Add as child of agent model
          }
        }
      }
    });

    console.log('[Renderer3D] Hexes with entityId:', entitiesFound, 'Entities found in map:', entitiesWithModels, 'Entity models created:', this.entityModels.size);

    // Render connections between hexes
    this.renderConnections(state);

    // Render adjacency links between entities that share resources
    this.renderAdjacencyLinks(state);
  }

  /**
   * Create a ring around entity base showing utilization level
   */
  private createUtilizationRing(utilization: number): THREE.Mesh {
    // Ring geometry - filled portion based on utilization
    const geometry = new THREE.RingGeometry(
      HEX_SIZE * 0.75,  // inner radius
      HEX_SIZE * 0.85,  // outer radius
      32,               // segments
      1,                // phi segments
      0,                // start angle
      Math.PI * 2 * utilization // sweep angle
    );

    // Color based on utilization level
    let color = 0x22c55e; // green - healthy
    if (utilization > 0.75) color = 0xf59e0b; // amber - busy
    if (utilization > 0.9) color = 0xef4444; // red - overloaded

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });

    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    return ring;
  }

  // Helper to darken a color (factor < 1 darkens, factor > 1 brightens)
  private darkenColor(color: number, factor: number): number {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.floor((color & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }

  // Alias for clarity
  private brightenColor(color: number, factor: number): number {
    return this.darkenColor(color, factor);
  }

  // Create the appropriate 3D model based on entity type
  private createEntityModel(entity: Entity): THREE.Group {
    switch (entity.category) {
      case 'agent':
        return this.createAgentModel(entity);
      case 'tool':
        return this.createToolModel(entity);
      default:
        return this.createAgentModel(entity);
    }
  }

  // Agent: Humanoid pawn piece
  private createAgentModel(entity: Entity): THREE.Group {
    const group = new THREE.Group();
    const agentEntity = entity as import('../state/store').AgentEntity;
    const color = AGENT_TEMPLATE_COLORS[agentEntity.template] || ENTITY_COLORS.agent;

    // Base - short cylinder
    const baseGeometry = new THREE.CylinderGeometry(12, 14, 6, 6);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.3,
      metalness: 0.6,
      roughness: 0.3,
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 3;
    base.castShadow = true;
    group.add(base);

    // Body - tapered cylinder
    const bodyGeometry = new THREE.CylinderGeometry(8, 11, 16, 6);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.2,
      metalness: 0.5,
      roughness: 0.4,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 14;
    body.castShadow = true;
    group.add(body);

    // Head - sphere
    const headGeometry = new THREE.SphereGeometry(10, 8, 6);
    const headMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: color,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.5,
    });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 28;
    head.castShadow = true;
    group.add(head);

    // Add a ring around the base for extra flair
    const ringGeometry = new THREE.TorusGeometry(16, 1.5, 8, 6);
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      metalness: 0.8,
      roughness: 0.2,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1;
    group.add(ring);

    return group;
  }

  // Tool: Different visuals based on tool type (filesystem, shell, tasklist)
  private createToolModel(entity: Entity): THREE.Group {
    const toolEntity = entity as import('../state/store').ToolEntity;
    const color = ENTITY_COLORS.tool;

    switch (toolEntity.toolType) {
      case 'filesystem':
        return this.createFilesystemToolModel(color);
      case 'shell':
        return this.createShellToolModel(color);
      case 'tasklist':
        return this.createTasklistToolModel(color);
      default:
        return this.createGenericToolModel(color);
    }
  }

  // Filesystem tool: Folder icon
  private createFilesystemToolModel(color: number): THREE.Group {
    const group = new THREE.Group();

    // Folder base
    const baseGeometry = new THREE.BoxGeometry(24, 16, 4);
    const baseMaterial = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.3, metalness: 0.4, roughness: 0.6,
    });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.position.y = 12;
    base.castShadow = true;
    group.add(base);

    // Folder tab
    const tabGeometry = new THREE.BoxGeometry(10, 4, 4);
    const tab = new THREE.Mesh(tabGeometry, baseMaterial);
    tab.position.set(-5, 22, 0);
    group.add(tab);

    // File icon inside
    const fileGeometry = new THREE.BoxGeometry(14, 12, 1);
    const fileMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: color, emissiveIntensity: 0.2,
    });
    const file = new THREE.Mesh(fileGeometry, fileMaterial);
    file.position.set(0, 12, 3);
    group.add(file);

    return group;
  }

  // Shell tool: Terminal icon
  private createShellToolModel(color: number): THREE.Group {
    const group = new THREE.Group();

    // Terminal body
    const bodyGeometry = new THREE.BoxGeometry(26, 18, 6);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e, emissive: color, emissiveIntensity: 0.2, metalness: 0.6, roughness: 0.4,
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 12;
    body.castShadow = true;
    group.add(body);

    // Screen
    const screenGeometry = new THREE.BoxGeometry(22, 14, 1);
    const screenMaterial = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.5,
    });
    const screen = new THREE.Mesh(screenGeometry, screenMaterial);
    screen.position.set(0, 12, 4);
    group.add(screen);

    // Prompt indicator (> symbol represented as lines)
    const promptGeometry = new THREE.BoxGeometry(4, 2, 0.5);
    const promptMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff00, emissive: 0x00ff00, emissiveIntensity: 0.8,
    });
    const prompt = new THREE.Mesh(promptGeometry, promptMaterial);
    prompt.position.set(-6, 14, 5);
    group.add(prompt);

    return group;
  }

  // Tasklist tool: Checklist icon
  private createTasklistToolModel(color: number): THREE.Group {
    const group = new THREE.Group();

    // Clipboard base
    const clipboardGeometry = new THREE.BoxGeometry(20, 28, 3);
    const clipboardMaterial = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.3, metalness: 0.4, roughness: 0.6,
    });
    const clipboard = new THREE.Mesh(clipboardGeometry, clipboardMaterial);
    clipboard.position.y = 14;
    clipboard.castShadow = true;
    group.add(clipboard);

    // Clip at top
    const clipGeometry = new THREE.BoxGeometry(8, 4, 4);
    const clipMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888, metalness: 0.8, roughness: 0.2,
    });
    const clip = new THREE.Mesh(clipGeometry, clipMaterial);
    clip.position.set(0, 29, 0);
    group.add(clip);

    // Checkbox lines
    for (let i = 0; i < 3; i++) {
      const checkGeometry = new THREE.BoxGeometry(3, 3, 1);
      const checkMaterial = new THREE.MeshStandardMaterial({
        color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.6,
      });
      const check = new THREE.Mesh(checkGeometry, checkMaterial);
      check.position.set(-6, 22 - i * 7, 2);
      group.add(check);

      const lineGeometry = new THREE.BoxGeometry(8, 2, 1);
      const lineMaterial = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
      });
      const line = new THREE.Mesh(lineGeometry, lineMaterial);
      line.position.set(2, 22 - i * 7, 2);
      group.add(line);
    }

    return group;
  }

  // Generic tool model fallback
  private createGenericToolModel(color: number): THREE.Group {
    const group = new THREE.Group();

    // Wrench/gear shape
    const gearGeometry = new THREE.TorusGeometry(10, 3, 6, 8);
    const gearMaterial = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.4, metalness: 0.7, roughness: 0.3,
    });
    const gear = new THREE.Mesh(gearGeometry, gearMaterial);
    gear.rotation.x = Math.PI / 2;
    gear.position.y = 12;
    gear.castShadow = true;
    group.add(gear);

    // Center hub
    const hubGeometry = new THREE.CylinderGeometry(4, 4, 6, 8);
    const hub = new THREE.Mesh(hubGeometry, gearMaterial);
    hub.position.y = 12;
    group.add(hub);

    return group;
  }

  /**
   * Create a provider badge showing the LLM provider logo
   * Returns null if provider logo is not available
   */
  private createProviderBadge(provider: string): THREE.Group | null {
    const logoPath = PROVIDER_LOGOS[provider.toLowerCase()];
    if (!logoPath) {
      return null;
    }

    const group = new THREE.Group();

    // Check if texture is already cached
    let texture = this.textureCache.get(logoPath);

    if (!texture) {
      // Load texture and cache it
      texture = this.textureLoader.load(logoPath, (loadedTexture) => {
        // Texture loaded successfully
        loadedTexture.colorSpace = THREE.SRGBColorSpace;
      }, undefined, (error) => {
        console.warn(`[Renderer3D] Failed to load provider logo: ${logoPath}`, error);
      });
      this.textureCache.set(logoPath, texture);
    }

    // Create a larger plane with the logo texture for better visibility
    const badgeSize = 14; // Increased from 8 to 14 for better visibility
    const geometry = new THREE.PlaneGeometry(badgeSize, badgeSize);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const badge = new THREE.Mesh(geometry, material);

    // Add a subtle glow background
    const glowGeometry = new THREE.PlaneGeometry(badgeSize + 2, badgeSize + 2);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.z = -0.1; // Slightly behind the badge

    group.add(glow);
    group.add(badge);

    // Badge is positioned in front (positive Z) of the agent model
    // PlaneGeometry by default faces the Z axis, so no rotation needed
    // The badge will face outward perpendicular to the board

    return group;
  }

  private getHexHeight(hex: { entityId?: string }, state: AppState): number {
    if (hex.entityId) {
      const entity = state.entities.get(hex.entityId);
      if (entity) {
        // Entities start at base height and grow from token usage during this run
        const runTokens = entity.metrics?.runTokens || 0;
        return (HEX_BASE_HEIGHT + calculateTokenBasedHeight(runTokens)) * 10;
      }
    }
    return HEX_BASE_HEIGHT * 10;
  }

  /**
   * Create floating capability indicators above an entity
   * Shows small icons for each type of resource the entity has access to
   */
  private createCapabilityIndicators(resourceTypes: string[]): THREE.Group {
    const group = new THREE.Group();

    const iconColors: Record<string, number> = {
      mcp: 0x06b6d4,    // Cyan for MCP/tools
      rag: 0xa855f7,    // Purple for RAG/knowledge
      datastore: 0x6b7280, // Gray for data stores
    };

    const spacing = 10;
    const startX = -((resourceTypes.length - 1) * spacing) / 2;

    resourceTypes.forEach((type, index) => {
      const color = iconColors[type] || 0xffffff;

      // Create a small glowing sphere for each capability
      const sphereGeometry = new THREE.SphereGeometry(3, 8, 8);
      const sphereMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      });
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
      sphere.position.x = startX + index * spacing;
      group.add(sphere);

      // Add a glow ring around each sphere
      const ringGeometry = new THREE.RingGeometry(4, 5.5, 16);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.x = startX + index * spacing;
      ring.rotation.x = -Math.PI / 2; // Lay flat
      group.add(ring);
    });

    return group;
  }

  /**
   * Create a floating rulefile indicator above an agent
   * Shows a document icon badge to indicate the agent has rulefiles equipped
   */
  private createRulefileIndicator(count: number): THREE.Group {
    const group = new THREE.Group();

    // Document-like icon color (amber/gold for rules)
    const rulefileColor = 0xf59e0b;

    // Create a small rectangular "document" shape
    const docWidth = 5;
    const docHeight = 7;
    const docGeometry = new THREE.PlaneGeometry(docWidth, docHeight);
    const docMaterial = new THREE.MeshBasicMaterial({
      color: rulefileColor,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const doc = new THREE.Mesh(docGeometry, docMaterial);
    group.add(doc);

    // Add a folded corner triangle (top right)
    const foldSize = 1.8;
    const foldGeometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      docWidth / 2 - foldSize, docHeight / 2, 0.01,    // top-left of fold
      docWidth / 2, docHeight / 2, 0.01,               // top-right
      docWidth / 2, docHeight / 2 - foldSize, 0.01,    // bottom
    ]);
    foldGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    const foldMaterial = new THREE.MeshBasicMaterial({
      color: this.darkenColor(rulefileColor, 0.7),
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const fold = new THREE.Mesh(foldGeometry, foldMaterial);
    group.add(fold);

    // Add horizontal "text lines" to make it look like a document
    const lineColor = this.darkenColor(rulefileColor, 0.6);
    for (let i = 0; i < 3; i++) {
      const lineGeometry = new THREE.PlaneGeometry(docWidth * 0.6, 0.5);
      const lineMaterial = new THREE.MeshBasicMaterial({
        color: lineColor,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      const line = new THREE.Mesh(lineGeometry, lineMaterial);
      line.position.y = docHeight / 2 - 2.5 - i * 1.2;
      line.position.z = 0.02;
      group.add(line);
    }

    // Add a glow ring around the document
    const ringGeometry = new THREE.RingGeometry(4.5, 6, 16);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: rulefileColor,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2; // Lay flat
    ring.position.y = -4; // Below the document
    group.add(ring);

    // If multiple rulefiles, add a count badge
    if (count > 1) {
      const badgeGeometry = new THREE.CircleGeometry(2.5, 16);
      const badgeMaterial = new THREE.MeshBasicMaterial({
        color: 0xef4444, // Red badge
        transparent: true,
        opacity: 0.95,
      });
      const badge = new THREE.Mesh(badgeGeometry, badgeMaterial);
      badge.position.set(docWidth / 2 + 1, -docHeight / 2 + 1, 0.05);
      group.add(badge);
    }

    return group;
  }

  private renderConnections(state: AppState): void {
    state.connections.forEach(conn => {
      const fromHex = state.hexes.get(conn.from);
      const toHex = state.hexes.get(conn.to);

      if (fromHex && toHex) {
        const fromPos = axialToPixel(fromHex.coord);
        const toPos = axialToPixel(toHex.coord);

        const fromHeight = this.getHexHeight(fromHex, state) + 5;
        const toHeight = this.getHexHeight(toHex, state) + 5;

        const points = [
          new THREE.Vector3(fromPos.x, fromHeight, fromPos.y),
          new THREE.Vector3(toPos.x, toHeight, toPos.y),
        ];

        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const lineMaterial = new THREE.LineBasicMaterial({
          color: conn.type === 'flow' ? 0x6366f1 : conn.type === 'hierarchy' ? 0x8b5cf6 : 0xeab308,
          linewidth: 2,
        });

        const line = new THREE.Line(lineGeometry, lineMaterial);
        this.connectionLines.add(line);
      }
    });
  }

  /**
   * Calculate edge position of a hex in the direction of another hex
   * Returns a point on the hex edge closest to the target
   */
  private getHexEdgePosition(
    fromPos: { x: number; y: number },
    toPos: { x: number; y: number },
    height: number
  ): THREE.Vector3 {
    // Calculate direction from source to target
    const dx = toPos.x - fromPos.x;
    const dz = toPos.y - fromPos.y;
    const distance = Math.sqrt(dx * dx + dz * dz);

    if (distance === 0) {
      return new THREE.Vector3(fromPos.x, height, fromPos.y);
    }

    // Normalize and scale to hex edge (HEX_SIZE is center to corner)
    // Use ~80% of hex size to stay inside the hex edge
    const edgeOffset = HEX_SIZE * 0.75;
    const edgeX = fromPos.x + (dx / distance) * edgeOffset;
    const edgeZ = fromPos.y + (dz / distance) * edgeOffset;

    return new THREE.Vector3(edgeX, height, edgeZ);
  }

  /**
   * Render visual links between agents and tools within range
   * Shows which agents have access to which tools via range/RBAC
   * Colors indicate workflow direction based on RBAC permissions:
   * - Read (blue): Agent can read from tool
   * - Write (amber): Agent can write to tool
   * - Read/Write (purple): Agent has both permissions
   */
  private renderAdjacencyLinks(state: AppState): void {
    // Clear old adjacency links and connection tracking
    this.adjacencyLinks.clear();
    this.connectionInfos.clear();

    // Track processed pairs to avoid duplicates
    const processedPairs = new Set<string>();

    // For each hex with an agent entity, find tools that can reach it
    state.hexes.forEach((hex, hexKey) => {
      if (!hex.entityId) return;

      const entity = state.entities.get(hex.entityId);
      if (!entity) return;

      // Only show adjacency links FROM agents TO tools
      if (entity.category !== 'agent') return;

      // Get all tools that can reach this agent (respects tool range)
      const resourcesInRange = getResourcesInRange(hexKey, state);

      for (const resource of resourcesInRange) {
        const toolEntity = state.entities.get(resource.entityId);
        if (!toolEntity || toolEntity.category !== 'tool') continue;

        const toolHexKey = resource.hexKey;

        // Create unique pair key to avoid duplicates
        const pairKey = [hexKey, toolHexKey].sort().join('-');
        if (processedPairs.has(pairKey)) continue;
        processedPairs.add(pairKey);

        // Determine RBAC permissions for this agent-tool relationship
        const rbacConfig = getEntityRBACConfig(toolEntity);
        let hasRead = false;
        let hasWrite = false;

        if (rbacConfig.useZones) {
          // Get direction from tool to agent
          const direction = getDirectionFromTo(toolHexKey, hexKey);
          if (direction) {
            const permissions = getZonePermissions(direction, rbacConfig.zoneConfig);
            hasRead = permissions.includes('read');
            hasWrite = permissions.includes('write');
          }
        } else {
          // If zones not enabled, assume full access
          hasRead = true;
          hasWrite = true;
        }

        // Determine color based on permissions
        let linkColor: number;
        if (hasRead && hasWrite) {
          linkColor = ZONE_COLORS.readwrite; // Purple
        } else if (hasRead) {
          linkColor = ZONE_COLORS.read; // Blue
        } else if (hasWrite) {
          linkColor = ZONE_COLORS.write; // Amber
        } else {
          linkColor = ZONE_COLORS.none; // Slate (no access)
        }

        // Get center positions
        const agentCenterPos = axialToPixel(hex.coord);
        const toolHex = state.hexes.get(toolHexKey);
        if (!toolHex) continue;
        const toolCenterPos = axialToPixel(toolHex.coord);

        // Get heights
        const agentHeight = this.getHexHeight({ entityId: hex.entityId }, state);
        const toolHeight = this.getHexHeight({ entityId: toolHex.entityId }, state);

        // Calculate edge positions (start from hex edges, not centers)
        const agentEdgePos = this.getHexEdgePosition(agentCenterPos, toolCenterPos, agentHeight + 5);
        const toolEdgePos = this.getHexEdgePosition(toolCenterPos, agentCenterPos, toolHeight + 5);

        // Create curved link (arc above the hexes)
        const midX = (agentEdgePos.x + toolEdgePos.x) / 2;
        const midZ = (agentEdgePos.z + toolEdgePos.z) / 2;
        const midY = Math.max(agentHeight, toolHeight) + 12; // Arc above both

        const curve = new THREE.QuadraticBezierCurve3(
          agentEdgePos,
          new THREE.Vector3(midX, midY, midZ),
          toolEdgePos
        );

        // Create thick tube for the connection line
        const tubeRadius = 1.2; // Thickness of the line
        const tubeGeometry = new THREE.TubeGeometry(curve, 24, tubeRadius, 8, false);
        const tubeMaterial = new THREE.MeshBasicMaterial({
          color: linkColor,
          transparent: true,
          opacity: 0.7,
        });
        const line = new THREE.Mesh(tubeGeometry, tubeMaterial);
        this.adjacencyLinks.add(line);

        // Create glow tube (wider, more transparent, behind main line)
        const glowTubeRadius = 2.5; // Wider for glow effect
        const glowGeometry = new THREE.TubeGeometry(curve, 24, glowTubeRadius, 8, false);
        const glowMaterial = new THREE.MeshBasicMaterial({
          color: linkColor,
          transparent: true,
          opacity: 0.15,
        });
        const glowLine = new THREE.Mesh(glowGeometry, glowMaterial);
        this.adjacencyLinks.add(glowLine);

        // Store connection info for glow updates
        this.connectionInfos.set(pairKey, {
          agentHexKey: hexKey,
          toolHexKey,
          hasRead,
          hasWrite,
          color: linkColor,
          line,
          glowLine,
        });

        // Add small glowing spheres at connection points (at edge positions)
        const sphereGeometry = new THREE.SphereGeometry(2.5, 12, 12);
        const sphereMaterial = new THREE.MeshBasicMaterial({
          color: linkColor,
          transparent: true,
          opacity: 0.8,
        });

        const sphere1 = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere1.position.copy(agentEdgePos);
        this.adjacencyLinks.add(sphere1);

        const sphere2 = new THREE.Mesh(sphereGeometry, sphereMaterial);
        sphere2.position.copy(toolEdgePos);
        this.adjacencyLinks.add(sphere2);
      }
    });
  }

  /**
   * Mark a connection as actively flowing (for glow effect)
   * Called when work.flowing events occur
   */
  public markConnectionFlowing(fromHexKey: string, toHexKey: string): void {
    const pairKey = [fromHexKey, toHexKey].sort().join('-');
    this.activeFlows.set(pairKey, performance.now());
  }

  /**
   * Update connection glow based on active flows and entity status
   */
  private updateConnectionGlow(time: number): void {
    const state = this.store.getState();
    const now = performance.now();
    const flowDuration = 2000; // Glow lasts 2 seconds after flow

    this.connectionInfos.forEach((info, pairKey) => {
      // Check if this connection has recent flow activity
      const lastFlowTime = this.activeFlows.get(pairKey);
      const isFlowing = lastFlowTime && (now - lastFlowTime) < flowDuration;

      // Also check if either entity is active/busy
      const agentHex = state.hexes.get(info.agentHexKey);
      const toolHex = state.hexes.get(info.toolHexKey);
      const agentEntity = agentHex?.entityId ? state.entities.get(agentHex.entityId) : null;
      const toolEntity = toolHex?.entityId ? state.entities.get(toolHex.entityId) : null;

      const isAgentActive = agentEntity?.status === 'active' || agentEntity?.status === 'busy';
      const isToolActive = toolEntity?.status === 'active' || toolEntity?.status === 'busy';
      const isActive = isFlowing || isAgentActive || isToolActive;

      // Calculate glow intensity
      let glowOpacity = 0.15; // Base glow
      let lineOpacity = 0.7;

      if (isActive) {
        // Pulsing glow when active
        const pulse = Math.sin(time * 4) * 0.5 + 0.5;
        glowOpacity = 0.3 + pulse * 0.4;
        lineOpacity = 0.8 + pulse * 0.2;
      }

      // Update glow mesh opacity
      if (info.glowLine) {
        const glowMat = info.glowLine.material as THREE.MeshBasicMaterial;
        glowMat.opacity = glowOpacity;
      }

      // Update main mesh opacity
      const lineMat = info.line.material as THREE.MeshBasicMaterial;
      lineMat.opacity = lineOpacity;

      // Clean up old flow entries
      if (lastFlowTime && (now - lastFlowTime) > flowDuration * 2) {
        this.activeFlows.delete(pairKey);
      }
    });
  }

  /**
   * Update entity glow/emissive intensity based on status
   */
  private updateEntityGlow(time: number): void {
    const state = this.store.getState();
    const isRunning = state.swarmStatus === 'running';
    const selectedHex = state.selectedHex;

    this.entityModels.forEach((model, hexKey) => {
      const hex = state.hexes.get(hexKey);
      if (!hex?.entityId) return;

      const entity = state.entities.get(hex.entityId);
      if (!entity) return;

      // Get visual config for this status
      const statusKey = entity.status as keyof typeof STATUS_VISUALS;
      const visuals = STATUS_VISUALS[statusKey] || STATUS_VISUALS.idle;

      // Calculate base glow intensity
      let intensity: number = visuals.glowIntensity;

      // Add breathing effect for active/running entities
      if (isRunning && visuals.breatheSpeed > 0) {
        const breatheRate = visuals.breatheSpeed / 1000; // Convert ms to rate
        const breathe = Math.sin(time * breatheRate * Math.PI * 2) * 0.5 + 0.5;
        intensity = intensity * (1 - BREATHE_AMPLITUDE) + intensity * BREATHE_AMPLITUDE * (0.5 + breathe * 0.5);
      }

      // Boost intensity if selected
      if (hexKey === selectedHex) {
        intensity = Math.min(1.0, intensity + GLOW.soft);
      }

      // Dim if not running
      if (!isRunning) {
        intensity *= 0.5;
      }

      // Apply to all meshes in the model
      model.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = intensity;
        }
      });
    });
  }

  /**
   * Smoothly animate selected entity lift
   */
  private updateSelectionAnimation(deltaTime: number): void {
    const state = this.store.getState();
    const selectedHex = state.selectedHex;

    this.entityModels.forEach((model, hexKey) => {
      // Get base Y position from userData, or current position
      if (model.userData.baseY === undefined) {
        model.userData.baseY = model.position.y;
        model.userData.currentLift = 0;
      }

      // Target lift amount
      const targetLift = hexKey === selectedHex ? SELECTION_LIFT : 0;
      const currentLift = model.userData.currentLift as number;

      // Smooth interpolation
      const lerpSpeed = 8; // Higher = faster
      const newLift = currentLift + (targetLift - currentLift) * Math.min(1, deltaTime * lerpSpeed);
      model.userData.currentLift = newLift;

      model.position.y = model.userData.baseY + newLift;
    });
  }

  /**
   * Update hex surface colors based on entity state
   */
  private updateHexStateColors(): void {
    const state = this.store.getState();
    const selectedHex = state.selectedHex;

    this.hexMeshes.forEach((mesh, hexKey) => {
      const hex = state.hexes.get(hexKey);
      if (!hex) return;

      const material = mesh.material as THREE.MeshStandardMaterial;
      let color: number = COLORS_HEX.hexSelected; // Default empty hex color (lightened)

      if (hex.entityId) {
        const entity = state.entities.get(hex.entityId);
        if (entity) {
          // Tint based on entity state (lightened versions)
          switch (entity.status) {
            case 'active':
            case 'busy':
              color = 0x2a3e2a; // Subtle green tint (lightened)
              break;
            case 'warning':
              color = 0x3e3a2a; // Subtle amber tint (lightened)
              break;
            case 'error':
              color = 0x3e2a2a; // Subtle red tint (lightened)
              break;
            default:
              color = COLORS_HEX.hexSelected; // Neutral (lightened)
          }
        }
      }

      // Brighten if selected
      if (hexKey === selectedHex) {
        color = this.brightenColor(color, 1.3);
      }

      material.color.setHex(color);
    });
  }

  /**
   * Update range highlighting for selected resource entities
   * Shows colored zone glows based on RBAC zone configuration:
   * - Blue for read zones
   * - Amber for write zones
   * - Purple for read/write zones
   */
  private updateRangeHighlights(): void {
    const state = this.store.getState();
    const selectedHex = state.selectedHex;

    // Clear existing range highlights
    this.rangeHighlights.forEach(highlight => this.scene.remove(highlight));
    this.rangeHighlights.clear();

    // Only show range for selected resource entities
    if (!selectedHex) return;

    const hex = state.hexes.get(selectedHex);
    if (!hex?.entityId) return;

    const entity = state.entities.get(hex.entityId);
    if (!entity) return;

    // Only show range for resource entities (non-agent entities with range)
    if (entity.category === 'agent') return;

    // Use preview range if available (for live slider updates), otherwise use entity's range
    const rangeOverride = state.previewRange ?? undefined;

    // Get zone visualization data (handles both range and explicit modes)
    const zoneData = getZoneVisualizationData(hex.entityId, state, rangeOverride);

    // Create highlights for all zones
    for (const zone of zoneData) {
      const targetMesh = this.hexMeshes.get(zone.hexKey);
      if (!targetMesh) continue;

      // Get hex height for proper sizing
      const hexHeight = (targetMesh.geometry as THREE.ExtrudeGeometry).parameters?.options?.depth || 5;

      // Get color based on zone type
      const zoneColor = ZONE_COLORS[zone.zoneType];

      // Create range highlight ring (slightly larger than the hex)
      const glowGeometry = this.createHexGeometry(hexHeight + 3);
      const glowEdges = new THREE.EdgesGeometry(glowGeometry, 30);

      // Fade opacity with distance, but keep minimum visibility
      const baseOpacity = zone.distance === 0 ? 0.9 : 0.8 - (zone.distance - 1) * 0.12;
      const opacity = Math.max(0.35, baseOpacity);

      const glowMaterial = new THREE.LineBasicMaterial({
        color: zoneColor,
        transparent: true,
        opacity,
      });

      const glowLines = new THREE.LineSegments(glowEdges, glowMaterial);
      glowLines.position.copy(targetMesh.position);
      glowLines.position.y -= 0.3;
      glowLines.rotation.copy(targetMesh.rotation);

      this.scene.add(glowLines);
      this.rangeHighlights.set(zone.hexKey, glowLines);

      // Add second glow layer for more bloom effect
      const glowGeometry2 = this.createHexGeometry(hexHeight + 5);
      const glowEdges2 = new THREE.EdgesGeometry(glowGeometry2, 30);
      const glowMaterial2 = new THREE.LineBasicMaterial({
        color: zoneColor,
        transparent: true,
        opacity: Math.max(0.15, opacity * 0.4),
      });

      const glowLines2 = new THREE.LineSegments(glowEdges2, glowMaterial2);
      glowLines2.position.copy(targetMesh.position);
      glowLines2.position.y -= 0.6;
      glowLines2.rotation.copy(targetMesh.rotation);

      this.scene.add(glowLines2);
      this.rangeHighlights.set(zone.hexKey + '-outer', glowLines2);
    }
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);

    // Calculate delta time for smooth animation
    const now = performance.now() / 1000;
    const deltaTime = this.lastTime > 0 ? now - this.lastTime : 0;
    this.lastTime = now;

    // Update entity visual states
    this.updateEntityGlow(now);
    this.updateSelectionAnimation(deltaTime);
    this.updateHexStateColors();
    this.updateRangeHighlights();
    this.updateConnectionGlow(now);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  getCanvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Dispose of all Three.js resources and remove the canvas from the DOM.
   * This is critical to prevent memory leaks and multiple canvas elements
   * when the React component remounts (e.g., due to StrictMode).
   */
  dispose(): void {
    console.log('[Renderer3D] Disposing renderer...');

    // Stop the animation loop
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    // Remove event listeners using the bound handlers
    window.removeEventListener('resize', this.boundHandleResize);
    this.renderer.domElement.removeEventListener('click', this.boundHandleClick);
    this.renderer.domElement.removeEventListener('contextmenu', this.boundHandleContextMenu);

    // Dispose of controls
    this.controls.dispose();

    // Clear all meshes from the scene and dispose their geometries/materials
    this.hexMeshes.forEach((mesh) => {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      if (mesh.material instanceof THREE.Material) {
        mesh.material.dispose();
      }
    });
    this.hexMeshes.clear();

    this.hexEdges.forEach((edge) => {
      this.scene.remove(edge);
      edge.geometry.dispose();
      if (edge.material instanceof THREE.Material) {
        edge.material.dispose();
      }
    });
    this.hexEdges.clear();

    this.entityModels.forEach((model) => {
      this.scene.remove(model);
      // Recursively dispose of all children
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (child.material instanceof THREE.Material) {
            child.material.dispose();
          }
        }
      });
    });
    this.entityModels.clear();

    // Remove and clear groups
    this.scene.remove(this.connectionLines);
    this.scene.remove(this.adjacencyLinks);

    // Dispose of the WebGL renderer
    this.renderer.dispose();

    // Remove the canvas from the DOM
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }

    console.log('[Renderer3D] Disposed successfully');
  }
}

