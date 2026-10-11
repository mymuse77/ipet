"""用 Playwright + 本机 Chromium 给 ipet 预览页截图:待机 / 喝水提醒 / 远眺提醒 三种状态。

环境要求(见 AGENTS.md):
- 本仓库 preview/.venv 里的 playwright
- /opt/meta-chromium/chrome
- file:// + --allow-file-access-from-files (Chromium 会拦截 localhost)
- shot_local.html 由 index.html 生成,importmap 指向本地 node_modules (CDN 会被代理拦截)

用法:
    ./preview/.venv/bin/python preview/shoot.py
"""
import asyncio
from playwright.async_api import async_playwright

PAGE = "file:///home/hatch/workspace/ipet/preview/shot_local.html"
SHOTS = "/home/hatch/workspace/ipet/preview/shots"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path="/opt/meta-chromium/chrome",
            args=[
                "--allow-file-access-from-files",
                "--use-gl=angle",
                "--use-angle=swiftshader",
                "--enable-unsafe-swiftshader",
                "--no-sandbox",
            ],
        )
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("console", lambda m: print("[console]", m.type, m.text[:160]) if m.type == "error" else None)
        page.on("pageerror", lambda e: print("[pageerror]", str(e)[:200]))

        async def shot(name, demo):
            url = PAGE if demo == "idle" else f"{PAGE}?demo={demo}"
            await page.goto(url)
            await page.wait_for_function("window.__ipetReady === true", timeout=60000)
            await page.wait_for_timeout(2500 if demo == "idle" else 5000)
            await page.screenshot(path=f"{SHOTS}/shot_{name}.png")
            print(f"[{name}] ok", flush=True)

        await shot("idle", "idle")
        await shot("water", "water")
        await shot("eye", "eye")
        await browser.close()


asyncio.run(main())
