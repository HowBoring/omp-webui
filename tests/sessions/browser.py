"""Actual Linux Chromium -> public DSH Connection/Remote/Session/Conversation -> Bun -> strict native worker.
Explicit synthetic fixture; no real provider inference or private product admission.
"""
import asyncio,json,os,shutil,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
CHROME = os.environ.get('CHROME_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
BUN = os.environ.get('OMP_WEB_BUN') or shutil.which('bun') or 'bun'
async def main():
 errors=[];wire=[]
 link=subprocess.check_output([BUN,'--no-env-file','vendor/host-sessions/session-component-main.js','--print-bootstrap'],cwd=ROOT,text=True).strip()
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox'])
  context=await browser.new_context();a=await context.new_page();b=await context.new_page()
  for page in (a,b):
   page.on('pageerror',lambda error:errors.append(str(error)))
   page.on('response',lambda response:wire.append({'status':response.status,'path':response.url.split('?')[0]}) if '/api/' in response.url else None)
  await a.goto(link);await a.wait_for_selector('[data-session-root-slot]')
  await a.get_by_label('Directory to authorize').fill(str(ROOT/'vendor/sessions-fixture/project'))
  await a.get_by_role('button',name='Review directory',exact=True).click()
  await a.get_by_role('button',name='Grant this directory and descendants',exact=True).click()
  await a.wait_for_selector('article[data-native-id="native-0000"]')
  await b.goto('http://127.0.0.1:3187/');await b.wait_for_selector('article[data-native-id="native-0000"]')
  await asyncio.gather(a.locator('article[data-native-id="native-0000"]').get_by_role('button',name='Open Session',exact=True).click(),b.locator('article[data-native-id="native-0000"]').get_by_role('button',name='Open Session',exact=True).click())
  await a.wait_for_selector('[data-interaction-id][data-scope="startup"]',timeout=20000)
  await b.wait_for_selector('[data-interaction-id][data-scope="startup"]')
  assert await a.locator('[data-native-binding]').get_attribute('data-native-binding')=='unconfirmed'
  assert await a.locator('[data-interaction-id]').get_attribute('data-interaction-id')==await b.locator('[data-interaction-id]').get_attribute('data-interaction-id')
  await a.get_by_label('Explicit answer').fill('Synthetic browser owner')
  await a.get_by_role('button',name='Submit explicit answer',exact=True).click()
  for page in (a,b):
   await page.wait_for_selector('[data-native-binding="native-0000"]',timeout=20000)
   await expect(page.locator("#conversation")).to_contain_text("Synthetic fixture input",timeout=15000)
  worker=await a.locator('[data-worker-id]').get_attribute('data-worker-id')
  assert worker==await b.locator('[data-worker-id]').get_attribute('data-worker-id')
  await a.reload();await a.wait_for_selector('[data-native-binding="native-0000"]')
  assert worker==await a.locator('[data-worker-id]').get_attribute('data-worker-id')
  assert not await a.locator('[data-interaction-id]').count()
  await a.screenshot(path=str(ROOT/'vendor/session-browser.png'),full_page=True)
  assert not errors,errors
  result={'status':'PASS','platform':'Linux Chromium','browser':browser.version,'realDSH':True,'realBun':True,'realStrictNative':True,'scenarios':['authenticated-explicit-grant','concurrent-open-one-worker','root-startup-ui-without-session','explicit-answer','original-native-history-via-DSH-Conversation','warm-refresh-same-worker'],'privateData':False,'normalProductAdmission':'blocked','errors':errors}
  (ROOT/'vendor/session-browser.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
  await context.close();await browser.close()
asyncio.run(main())
