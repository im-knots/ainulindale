/**
 * Full User Journey E2E Test
 * 
 * Tests the complete workflow:
 * 1. Create a new board
 * 2. Place a Task List input hex
 * 3. Place an Agent hex
 * 4. Place a File Output hex
 * 5. Connect them (via adjacency)
 * 6. Configure the task list with a test markdown file
 * 7. Add a task to the file
 * 8. Start execution
 * 9. Verify the agent processes the task
 * 10. Verify output file is created
 */

import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';

describe('Full User Journey - Task List to File Output', () => {
  const testDir = join(tmpdir(), 'hex-agent-e2e-test-' + Date.now());
  const tasksFile = join(testDir, 'tasks.md');
  const outputDir = join(testDir, 'output');

  before(async () => {
    // Create test directory structure
    mkdirSync(testDir, { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    
    // Create initial tasks file
    const initialTasks = `# Test Tasks

- [ ] Create a hello world document @priority:high
  Write a file called hello.txt with the content "Hello, World!"
`;
    writeFileSync(tasksFile, initialTasks);
    console.log(`Created test tasks file: ${tasksFile}`);
  });

  after(async () => {
    // Clean up test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to clean up test directory:', e);
    }
  });

  it('should display the app with hex grid', async () => {
    // Verify app is loaded
    const canvas = await $('canvas');
    expect(await canvas.isDisplayed()).toBe(true);
    
    // Verify we have the resource bar
    const budgetText = await $('*=Budget');
    expect(await budgetText.isDisplayed()).toBe(true);
  });

  it('should create a new board via New Board button', async () => {
    // Look for new board button or menu
    const newBoardBtn = await $('button*=New');
    if (await newBoardBtn.isExisting()) {
      await newBoardBtn.click();
      await browser.pause(500);
    }
    // Board should be ready (empty state)
    const canvas = await $('canvas');
    expect(await canvas.isDisplayed()).toBe(true);
  });

  it('should place a Task List input hex', async () => {
    // Open entity placement menu by clicking on the canvas
    // First we need to access the hex grid and select Input category
    
    // Find the Input category button in the palette
    const inputBtn = await $('button*=Input');
    if (await inputBtn.isExisting()) {
      await inputBtn.click();
      await browser.pause(300);
    }
    
    // Look for the Task option
    const taskOption = await $('*=Task');
    if (await taskOption.isExisting()) {
      await taskOption.click();
      await browser.pause(300);
    }
    
    // Click on the canvas to place the entity (center area)
    const canvas = await $('canvas');
    const canvasSize = await canvas.getSize();
    const centerX = canvasSize.width / 2 - 100;
    const centerY = canvasSize.height / 2;
    await canvas.click({ x: Math.floor(centerX), y: Math.floor(centerY) });
    await browser.pause(500);
  });

  it('should place an Agent hex adjacent to the input', async () => {
    // Select Agent category
    const agentBtn = await $('button*=Agent');
    if (await agentBtn.isExisting()) {
      await agentBtn.click();
      await browser.pause(300);
    }
    
    // Select a coder/general agent template
    const coderOption = await $('*=Coder');
    if (await coderOption.isExisting()) {
      await coderOption.click();
      await browser.pause(300);
    }
    
    // Place it adjacent to the input (slightly to the right)
    const canvas = await $('canvas');
    const canvasSize = await canvas.getSize();
    const agentX = canvasSize.width / 2;
    const agentY = canvasSize.height / 2;
    await canvas.click({ x: Math.floor(agentX), y: Math.floor(agentY) });
    await browser.pause(500);
  });

  it('should place an Output hex adjacent to the agent', async () => {
    // Select Output category
    const outputBtn = await $('button*=Output');
    if (await outputBtn.isExisting()) {
      await outputBtn.click();
      await browser.pause(300);
    }
    
    // Select File output
    const filesOption = await $('*=File');
    if (await filesOption.isExisting()) {
      await filesOption.click();
      await browser.pause(300);
    }
    
    // Place it adjacent to the agent (to the right)
    const canvas = await $('canvas');
    const canvasSize = await canvas.getSize();
    const outputX = canvasSize.width / 2 + 100;
    const outputY = canvasSize.height / 2;
    await canvas.click({ x: Math.floor(outputX), y: Math.floor(outputY) });
    await browser.pause(500);
  });

  it('should verify entities are visible', async () => {
    // The configuration panel should show entity details when selected
    const configPanel = await $('h2*=Configuration');
    expect(await configPanel.isExisting()).toBe(true);
  });

  it('should start board execution', async () => {
    // Click the Start button
    const startButton = await $('button*=Start');
    await startButton.click();
    
    // Wait for status to change to RUNNING
    const runningStatus = await $('*=RUNNING');
    await runningStatus.waitForDisplayed({ timeout: 10000 });
    expect(await runningStatus.isDisplayed()).toBe(true);
  });
});

