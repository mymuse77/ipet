"""用 Playwright 给 ipet 预览页截图:待机 / 喝水提醒 / 远眺提醒 三种状态。"""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/index.html"
SHOTS = "/home/hatch/workspace/ipet/preview/shots"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=[
            "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        ])
        page = await browser.new_page(viewport={"width": 1280, "height": 800})

        async def shot(name, demo):
            url = BASE if demo == "idle" else f"{BASE}?demo={demo}"
            await page.goto(url)
            # 等 VRM 或兜底宠物就绪
            try:
                await page.wait_for_function("window.__ipetReady === true", timeout=45000)
            except Exception as e:
                print(f"[{name}] 等待超时: {e}")
            await page.wait_for_timeout(2500 if demo == "idle" else 4500)
            await page.screenshot(path=f"{SHOTS}/shot_{name}.png")
            print(f"[{name}] ok")

        await shot("idle", "idle")
        await shot("water", "water")
        await shot("eye", "eye")
        await browser.close()

asyncio.run(main())
