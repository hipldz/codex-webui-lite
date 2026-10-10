import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get("CODEX_WEB_VERIFY_URL", "http://127.0.0.1:8876/codex/")
OUT = Path("artifacts/screenshots")

async def check_page(browser, viewport, name):
    page = await browser.new_page(viewport=viewport, color_scheme="light")
    page.set_default_timeout(8_000)
    errors, failed = [], []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("requestfailed", lambda r: failed.append(f"{r.url}: {r.failure}"))
    response = await page.goto(BASE + "?demo=1", wait_until="networkidle")
    assert response and response.ok, f"Page failed: {response.status if response else 'none'}"
    await page.locator(".tool-row").first.wait_for()
    assert await page.get_by_role("button", name="Allow + update exec policy").count() == 1
    assert await page.locator(".tool-row.file_change .tool-summary").first.get_attribute("aria-expanded") == "false"
    overflow = await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    assert not overflow, f"Horizontal overflow at {viewport}"
    await page.screenshot(path=str(OUT / f"{name}.png"), full_page=True)
    if name == "desktop":
        file_link = page.locator(".workspace-file-link").first
        assert (await file_link.get_attribute("href")).startswith("/codex/?file=")
        await file_link.click()
        await page.locator(".file-drawer .preview-pane pre").wait_for()
        await page.get_by_role("button", name="Close files").click()
        await page.get_by_role("button", name="Changes").click()
        await page.locator(".diff-drawer").wait_for()
        assert await page.locator(".diff-drawer .added").count() > 0
        assert await page.locator(".changed-files button").count() == 2
        await page.screenshot(path=str(OUT / "desktop-changes.png"), full_page=True)
        await page.get_by_role("button", name="Close changes").click()
        await page.get_by_role("button", name="Collapse threads").click()
        await page.wait_for_timeout(220)
        assert await page.locator(".desktop-sidebar").evaluate("el => el.getBoundingClientRect().width") == 0
        await page.get_by_role("button", name="Open threads").click()
        await page.wait_for_timeout(220)
        await page.locator(".workspace-switcher").click()
        await page.locator(".workspace-picker").wait_for()
        await page.screenshot(path=str(OUT / "desktop-workspace.png"), full_page=True)
        await page.get_by_role("button", name="Close workspace picker").click()
        await page.locator(".thread").nth(1).locator(".thread-main").click()
        assert await page.locator(".desktop-sidebar").evaluate("el => el.getBoundingClientRect().width") > 200
        second_thread = page.locator(".thread").nth(1)
        await second_thread.hover()
        await second_thread.locator(".thread-more").click()
        await page.get_by_role("button", name="Archive", exact=True).click()
        assert await page.locator(".thread-tabs button").nth(1).locator("small").inner_text() == "1"
        await page.locator(".thread-tabs button").nth(1).click()
        await page.locator(".thread").first.hover()
        await page.locator(".thread .thread-more").first.click()
        await page.get_by_role("button", name="Restore", exact=True).click()
        await page.locator(".thread-tabs button").first.click()
        await page.get_by_role("button", name="Select threads").click()
        await page.locator(".thread").nth(0).locator(".thread-main").click()
        await page.locator(".thread").nth(1).locator(".thread-main").click()
        await page.get_by_role("button", name="Archive selected").click()
        assert await page.locator(".thread-tabs button").nth(1).locator("small").inner_text() == "2"
        await page.locator(".thread-tabs button").nth(1).click()
        await page.get_by_role("button", name="Select threads").click()
        await page.locator(".thread").nth(0).locator(".thread-main").click()
        await page.locator(".thread").nth(1).locator(".thread-main").click()
        await page.get_by_role("button", name="Restore selected").click()
        await page.locator(".thread-tabs button").first.click()
        await page.locator(".model-trigger").click()
        await page.locator(".model-menu").wait_for()
        slider = page.get_by_role("slider", name="Reasoning effort")
        assert await slider.count() == 1
        await slider.fill("3")
        assert (await page.locator(".effort-title strong").inner_text()).lower() == "xhigh"
        await page.screenshot(path=str(OUT / "desktop-models.png"), full_page=True)
        await page.locator(".model-trigger").click()
        await page.get_by_role("button", name="New thread").first.click()
        async with page.expect_file_chooser() as chooser_info:
            await page.get_by_role("button", name="Add attachment").click()
        chooser = await chooser_info.value
        await chooser.set_files({"name": "notes.txt", "mimeType": "text/plain", "buffer": b"Attachment works"})
        await page.locator(".attachment-chip", has_text="notes.txt").wait_for()
        await page.get_by_role("button", name="Remove notes.txt").click()
        await page.locator(".composer textarea").evaluate("""element => {
          const transfer = new DataTransfer();
          transfer.items.add(new File(['clipboard attachment'], 'clipboard.txt', {type: 'text/plain'}));
          element.dispatchEvent(new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true}));
        }""")
        await page.locator(".attachment-chip", has_text="clipboard.txt").wait_for()
        await page.locator(".composer textarea").fill("plain clipboard text")
        assert await page.locator(".composer textarea").input_value() == "plain clipboard text"
        await page.get_by_role("button", name="Remove clipboard.txt").click()
        await page.locator(".composer textarea").evaluate("""element => {
          const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([png], 'clipboard.png', {type: 'image/png'}));
          element.dispatchEvent(new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true}));
        }""")
        image_chip = page.locator(".attachment-chip", has_text="clipboard.png")
        await image_chip.wait_for()
        assert await image_chip.locator("img").count() == 1
        await page.get_by_role("button", name="View clipboard.png").click()
        await page.locator(".image-lightbox img").wait_for()
        await page.get_by_role("button", name="Close image preview").click()
        await page.locator(".composer textarea").fill("image pasted from clipboard")
        await page.get_by_role("button", name="Send").click()
        await page.locator(".message.user .user-attachment-image").wait_for()
        await page.get_by_role("button", name="Send").wait_for()
        indicator = page.locator(".context-indicator")
        await indicator.hover()
        await page.locator(".context-tooltip", has_text="tokens used").wait_for()
        empty_metrics = await page.evaluate("({ body: document.body.scrollHeight === innerHeight, conversation: document.querySelector('.conversation').scrollHeight <= document.querySelector('.conversation').clientHeight })")
        assert empty_metrics["body"], f"Page overflow after pasted image: {empty_metrics}"
        await page.screenshot(path=str(OUT / "desktop-empty.png"), full_page=True)
        await page.get_by_role("button", name="Settings").click()
        await page.locator(".resource-card").wait_for()
        assert await page.locator(".context-card").count() == 1
        assert await page.locator(".compaction-status").count() == 0
        assert await page.locator(".account-card").count() == 1
        await page.screenshot(path=str(OUT / "desktop-settings.png"), full_page=True)
        await page.get_by_role("button", name="Close settings").click()
    await page.get_by_role("button", name="Files").first.click()
    await page.locator(".file-drawer").wait_for()
    if name == "desktop":
        await page.get_by_role("button", name="New file").click()
        await page.locator(".new-file-form input").fill("scratch.md")
        await page.locator(".new-file-form").get_by_role("button", name="Create", exact=True).click()
        await page.locator(".preview-head", has_text="scratch.md").wait_for()
        await page.get_by_role("button", name="Delete file").click()
        await page.locator(".delete-confirm").get_by_role("button", name="Delete", exact=True).click()
        await page.locator(".preview-empty").wait_for()
        await page.locator(".upload-notice", has_text="deleted").wait_for()
        async with page.expect_file_chooser() as upload_info:
            await page.locator(".upload-button").click()
        upload_chooser = await upload_info.value
        await upload_chooser.set_files({"name": "uploaded.txt", "mimeType": "text/plain", "buffer": b"uploaded from Files drawer"})
        await page.locator(".upload-notice", has_text="uploaded").wait_for()
    await page.locator(".tree-pane .tree-row.folder", has_text="src").click()
    await page.locator(".tree-pane .tree-row.file", has_text="users.ts").click()
    await page.locator(".preview-pane pre").wait_for()
    await page.get_by_role("button", name="Edit", exact=True).click()
    editor = page.locator(".file-editor")
    await editor.fill((await editor.input_value()) + "\n// edited in Codex Web")
    await page.get_by_role("button", name="Save", exact=True).click()
    await page.get_by_role("button", name="Saved").wait_for()
    await page.wait_for_timeout(250)
    await page.screenshot(path=str(OUT / f"{name}-files.png"), full_page=True)
    assert not errors, f"Console errors: {errors}"
    assert not failed, f"Failed requests: {failed}"
    await page.close()

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path="/home/pldz/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome",
        )
        await check_page(browser, {"width": 1440, "height": 900}, "desktop")
        await check_page(browser, {"width": 390, "height": 844}, "mobile")
        for width, height in [(375, 812), (430, 932), (1280, 800)]:
            page = await browser.new_page(viewport={"width": width, "height": height})
            await page.goto(BASE + "?demo=1", wait_until="networkidle")
            assert not await page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
            await page.close()
        deep_link = await browser.new_page(viewport={"width": 1280, "height": 800})
        await deep_link.goto(BASE + "?demo=1&file=src%2Fserver%2Fusers.ts", wait_until="networkidle")
        await deep_link.locator(".file-drawer .preview-pane pre").wait_for()
        assert deep_link.url.startswith(BASE)
        await deep_link.close()
        live = await browser.new_page(viewport={"width": 1280, "height": 800})
        failures = []
        live.on("requestfailed", lambda r: failures.append(r.url))
        await live.goto(BASE, wait_until="domcontentloaded")
        await live.wait_for_timeout(1800)
        assert await live.locator(".connection.online").count() == 1, "HTTP transport did not connect"
        assert await live.locator(".error-card").count() == 0, "Live app-server request failed"
        thread_count = await live.locator(".desktop-sidebar .thread").count()
        assert thread_count > 0, "Global session list did not load"
        await live.get_by_role("button", name="Settings").click()
        await live.locator(".resource-card").wait_for(timeout=10_000)
        assert "MB" in await live.locator(".resource-total b").inner_text()
        await live.get_by_role("button", name="Close settings").click()
        composer = live.locator(".composer textarea")
        assert not await composer.is_disabled(), "New-thread composer is disabled"
        await composer.fill("draft prompt survives workspace selection")
        await live.get_by_role("button", name="Send").click()
        await live.locator(".workspace-picker").wait_for()
        assert await composer.input_value() == "draft prompt survives workspace selection"
        await live.get_by_role("button", name="Use this folder").click()
        await live.locator(".workspace-picker").wait_for(state="detached", timeout=10_000)
        assert await composer.input_value() == "draft prompt survives workspace selection"
        assert all("/codex/" in url for url in failures), f"Request escaped base path: {failures}"
        await live.reload(wait_until="domcontentloaded")
        await live.locator(".connection.online").wait_for(timeout=10_000)
        first_session = live.locator(".desktop-sidebar .thread .thread-main").first
        await first_session.click()
        await live.wait_for_function("new URL(location.href).searchParams.has('session')", timeout=15_000)
        remembered_session = await live.evaluate("new URL(location.href).searchParams.get('session')")
        await live.reload(wait_until="domcontentloaded")
        await live.locator(".thread.active").wait_for(timeout=20_000)
        assert await live.evaluate("new URL(location.href).searchParams.get('session')") == remembered_session
        await live.close()
        await browser.close()
    print(f"UI verification passed; global sessions loaded: {thread_count}")

asyncio.run(main())
