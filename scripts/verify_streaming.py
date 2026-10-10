import asyncio
import base64
import os
from playwright.async_api import async_playwright

BASE = os.environ.get("CODEX_WEB_VERIFY_URL", "http://127.0.0.1:8876/codex/")
CHROME = "/home/pldz/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=CHROME)
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.locator(".connection.online").wait_for(timeout=10_000)
        await page.locator(".model-trigger").click()
        await page.locator(".model-menu > button").first.wait_for(timeout=10_000)
        model_count = await page.locator(".model-menu > button").count()
        await page.locator(".model-trigger").click()
        await page.get_by_role("button", name="New thread").first.click()
        if await page.locator(".workspace-picker").count():
            await page.get_by_role("button", name="Use this folder").click()
            await page.locator(".workspace-picker").wait_for(state="detached", timeout=20_000)
        composer = page.locator(".composer textarea")
        await composer.wait_for(state="visible")
        await page.wait_for_function("!document.querySelector('.composer textarea').disabled", timeout=15_000)
        async with page.expect_file_chooser() as chooser_info:
            await page.get_by_role("button", name="Add attachment").click()
        chooser = await chooser_info.value
        await chooser.set_files({
            "name": "pixel.png",
            "mimeType": "image/png",
            "buffer": base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="),
        })
        await page.locator(".attachment-chip", has_text="pixel.png").wait_for()
        await page.evaluate("""
          window.__streamSamples = [];
          window.__thinkingSeen = false;
          const root = document.querySelector('.conversation');
          const capture = () => {
            const text = document.querySelector('.assistant-body')?.textContent?.trim() || '';
            if (text && window.__streamSamples.at(-1) !== text) window.__streamSamples.push(text);
            if (document.querySelector('.tool-row.thinking, .thinking-live')) window.__thinkingSeen = true;
          };
          new MutationObserver(capture).observe(root, {subtree: true, childList: true, characterData: true});
        """)
        await composer.fill("A tiny PNG is attached. Then explain in about 180 words how streaming UI updates improve a coding agent experience. Use several short paragraphs and do not use tools.")
        await page.locator("button.send").click()
        await page.locator('button.send[aria-label="Stop"]').wait_for(timeout=15_000)
        await page.locator(".message.user .user-attachment-image").wait_for(timeout=10_000)
        await page.locator('button.send[aria-label="Send"]').wait_for(timeout=120_000)
        samples = await page.evaluate("window.__streamSamples")
        thinking = await page.evaluate("window.__thinkingSeen")
        reasoning_cards = await page.locator(".tool-row.thinking").count()
        assert model_count > 0, "model/list did not populate the picker"
        assert len(samples) >= 2, f"assistant text did not stream; samples={len(samples)}"
        assert thinking, "thinking state was never visible"
        assert reasoning_cards > 0, "no real reasoning summary item was rendered"
        await page.locator(".context-indicator").hover()
        await page.locator(".context-tooltip", has_text="tokens used").wait_for(timeout=10_000)
        await page.get_by_role("button", name="Settings").click()
        await page.locator(".resource-card").wait_for(timeout=10_000)
        await page.locator(".context-card").wait_for(timeout=10_000)
        await page.get_by_role("button", name="Close settings").click()
        assert not errors, f"console errors: {errors}"
        print(f"Streaming verification passed: {len(samples)} text updates, {model_count} models, reasoning_cards={reasoning_cards}")
        await browser.close()

asyncio.run(main())
