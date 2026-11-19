"""Actual Host SIGKILL + durable metadata restart; browser retains credentials, never reopens/replays automatically."""
import asyncio,json,os,shutil,signal,subprocess
from pathlib import Path
from playwright.async_api import async_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
CHROME = os.environ.get('CHROME_EXECUTABLE') or shutil.which('chromium') or shutil.which('google-chrome')
BUN = os.environ.get('OMP_WEB_BUN') or shutil.which('bun') or 'bun'
COMMAND=[BUN,'--no-env-file','vendor/host-sessions/session-component-main.js']
def start():
 child=subprocess.Popen(COMMAND,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 line=child.stdout.readline()
 if '"sessionAdmission":"blocked"' not in line: raise RuntimeError('synthetic Host failed startup')
 return child
async def main():
 host=start();errors=[]
 try:
  link=subprocess.check_output(COMMAND+['--print-bootstrap'],cwd=ROOT,text=True).strip()
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path=CHROME,headless=True,args=['--no-sandbox'])
   context=await browser.new_context();page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   await page.goto(link);await page.wait_for_selector('article[data-native-id="native-0000"]')
   await page.locator('article[data-native-id="native-0000"]').get_by_role('button',name='Open Session',exact=True).click()
   await page.wait_for_selector('[data-interaction-id][data-scope="startup"]',timeout=20000)
   await page.get_by_label('Explicit answer').fill('Synthetic before crash');await page.get_by_role('button',name='Submit explicit answer',exact=True).click()
   await page.wait_for_selector('[data-native-binding="native-0000"]');await expect(page.locator('#conversation')).to_contain_text('Synthetic fixture input')
   before=await page.locator('[data-worker-id]').get_attribute('data-worker-id')
   host.kill();assert host.wait(timeout=5)==-signal.SIGKILL
   host=start();await page.reload();await page.wait_for_selector('[data-session-root-slot]')
   await expect(page.locator('[data-session-index]')).to_contain_text('SESSION_HOST_RESTARTED_MANUAL_OPEN_REQUIRED')
   assert await page.locator('[data-native-binding]').get_attribute('data-native-binding')=='unconfirmed'
   await page.wait_for_timeout(500);assert not await page.locator('[data-interaction-id]').count()
   assert await page.locator('#conversation').inner_text()==''
   await page.locator('article[data-native-id="native-0000"]').get_by_role('button',name='Open Session',exact=True).click()
   await page.wait_for_selector('[data-interaction-id][data-scope="startup"]',timeout=20000)
   await page.get_by_label('Explicit answer').fill('Synthetic manual reopen');await page.get_by_role('button',name='Submit explicit answer',exact=True).click()
   await page.wait_for_selector('[data-native-binding="native-0000"]');await expect(page.locator('#conversation')).to_contain_text('Synthetic fixture input')
   after=await page.locator('[data-worker-id]').get_attribute('data-worker-id');assert after!=before
   assert not errors,errors
   result={'status':'PASS','platform':'Linux Chromium','browser':browser.version,'scenario':'actual Host SIGKILL/restart/manual same-native-ID reopen','credentialSurvived':True,'indexSurvived':True,'automaticOpen':False,'automaticReplay':False,'sameNativeSession':'native-0000','newWorkerGeneration':True,'privateData':False,'normalProductAdmission':'blocked','limits':['SIGKILL cannot run Host cooperative cleanup; worker pipe EOF and manual reopening provide subsequent native ownership checks.']}
   (ROOT/'vendor/session-restart-browser.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
   await context.close();await browser.close()
 finally:
  if host.poll() is None: host.send_signal(signal.SIGTERM)
  code=host.wait(timeout=40)
  if code!=0: raise RuntimeError('owned Host did not cleanly stop')
asyncio.run(main())
