# Ainulindale E2E Tests (Tauri)

End-to-end tests for the Ainulindale native desktop app using WebdriverIO and tauri-driver.

## Prerequisites

1. **Rust & Cargo**: Required for building the Tauri app and tauri-driver
2. **tauri-driver**: Install with `cargo install tauri-driver`
3. **Node.js**: Required for WebdriverIO

## Setup

```bash
# From the frontend directory
npm run test:tauri-e2e:install

# Or from this directory
npm install
```

## Running Tests

```bash
# From the frontend directory
npm run test:tauri-e2e

# Or from this directory
npm test
```

The test suite will:
1. Build the Tauri app in debug mode
2. Start `tauri-driver` (WebDriver proxy for Tauri)
3. Run all WebdriverIO specs against the native app
4. Clean up processes after tests complete

## Writing Tests

Tests are written using WebdriverIO with Mocha. See `specs/app.e2e.js` for examples.

```javascript
describe('My Feature', () => {
  it('should do something', async () => {
    const element = await $('button*=Click Me');
    await element.click();
    expect(await element.isDisplayed()).toBe(true);
  });
});
```

## Differences from Playwright

- Uses WebdriverIO selectors instead of Playwright locators
- Tests run against the actual native Tauri app, not a browser
- Native file system and shell access work correctly

