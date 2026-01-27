/**
 * Hex Agent E2E Tests
 * 
 * These tests run against the native Tauri app using WebdriverIO and tauri-driver.
 * Migrated from Playwright tests to work with the native desktop app.
 */

describe('Hex Agent App', () => {
  it('should load the app and show title', async () => {
    const title = await browser.getTitle();
    expect(title).toContain('Hex Agent');
  });

  it('should display the resource bar with budget info', async () => {
    // Check budget section exists
    const budgetText = await $('*=Budget');
    expect(await budgetText.isDisplayed()).toBe(true);
  });

  it('should display work metrics section', async () => {
    // Check for work metrics labels
    const queuedText = await $('*=Queued');
    const activeText = await $('*=Active');
    const doneText = await $('*=Done');
    
    expect(await queuedText.isDisplayed()).toBe(true);
    expect(await activeText.isDisplayed()).toBe(true);
    expect(await doneText.isDisplayed()).toBe(true);
  });

  it('should display control panel with start/stop buttons', async () => {
    // Check for control buttons
    const startButton = await $('button*=Start');
    const stopButton = await $('button*=Stop');
    
    expect(await startButton.isDisplayed()).toBe(true);
    expect(await stopButton.isDisplayed()).toBe(true);
  });

  it('should show STOPPED status initially', async () => {
    const stoppedStatus = await $('*=STOPPED');
    expect(await stoppedStatus.isDisplayed()).toBe(true);
  });

  it('should display configuration panel', async () => {
    const configHeading = await $('h2*=Configuration');
    expect(await configHeading.isDisplayed()).toBe(true);
  });
});

describe('Board Controls', () => {
  it('should start execution when Start button is clicked', async () => {
    // Click start button
    const startButton = await $('button*=Start');
    await startButton.click();

    // Wait for status to change to RUNNING
    const runningStatus = await $('*=RUNNING');
    await runningStatus.waitForDisplayed({ timeout: 5000 });
    expect(await runningStatus.isDisplayed()).toBe(true);

    // Stop execution to clean up
    const stopButton = await $('button*=Stop');
    await stopButton.click();
    
    // Wait for status to return to STOPPED
    const stoppedStatus = await $('*=STOPPED');
    await stoppedStatus.waitForDisplayed({ timeout: 5000 });
  });

  it('should stop execution when Stop button is clicked', async () => {
    // Start first
    const startButton = await $('button*=Start');
    await startButton.click();
    
    const runningStatus = await $('*=RUNNING');
    await runningStatus.waitForDisplayed({ timeout: 5000 });

    // Click stop
    const stopButton = await $('button*=Stop');
    await stopButton.click();

    // Verify stopped
    const stoppedStatus = await $('*=STOPPED');
    await stoppedStatus.waitForDisplayed({ timeout: 5000 });
    expect(await stoppedStatus.isDisplayed()).toBe(true);
  });
});

describe('Settings Panel', () => {
  it('should open settings when settings button is clicked', async () => {
    // Find and click settings button (gear icon)
    const settingsButton = await $('button*=⚙️');
    await settingsButton.click();

    // Settings panel should appear
    const settingsPanel = await $('*=LLM Settings');
    await settingsPanel.waitForDisplayed({ timeout: 3000 });
    expect(await settingsPanel.isDisplayed()).toBe(true);
  });

  it('should close settings when close button is clicked', async () => {
    // Open settings first
    const settingsButton = await $('button*=⚙️');
    await settingsButton.click();
    
    const settingsPanel = await $('*=LLM Settings');
    await settingsPanel.waitForDisplayed({ timeout: 3000 });

    // Find and click close button
    const closeButton = await $('button*=✕');
    await closeButton.click();

    // Settings panel should disappear
    await settingsPanel.waitForDisplayed({ timeout: 2000, reverse: true });
  });
});

describe('Three.js Canvas', () => {
  it('should render the hex grid canvas', async () => {
    // Check that a canvas element exists (Three.js renders to canvas)
    const canvas = await $('canvas');
    expect(await canvas.isDisplayed()).toBe(true);
  });

  it('should have proper canvas dimensions', async () => {
    const canvas = await $('canvas');
    const width = await canvas.getAttribute('width');
    const height = await canvas.getAttribute('height');
    
    // Canvas should have meaningful dimensions
    expect(parseInt(width)).toBeGreaterThan(100);
    expect(parseInt(height)).toBeGreaterThan(100);
  });
});

