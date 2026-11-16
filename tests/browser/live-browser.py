"""Actual Linux Chromium -> DSH Connection/Remote/controller/Conversation -> Bun -> native CLI.
Controlled in-process provider; no real AI inference. LIVE_MODE=first-materialization expects explicit invalidation.
"""
import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
async def main():
 frames=[];errors=[]
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=await browser.new_page()
  page.on('pageerror',lambda error:errors.append(str(error)))
  def received(raw):
   value=json.loads(raw)
   if value.get('type')=='item' and value.get('value',{}).get('type') in ['snapshot','event','assistant-stream']:
    frames.append(value)
  page.on('websocket',lambda socket:socket.on('framereceived',received))
  await page.goto(os.environ['LIVE_URL'])
  await page.wait_for_function("document.querySelector('#status').textContent.startsWith('Ready')")
  initial=json.loads(await page.locator('#evidence').inner_text());native_id=initial['sessionId']
  await page.locator('#draft').fill('Unsent independent fixture draft')
  await page.locator('#prompt').click()
  if os.environ.get('LIVE_MODE')=='first-materialization':
   await page.wait_for_function("document.querySelector('#status').textContent.includes('invalidated')")
   await page.wait_for_timeout(500)
  else:
   await page.wait_for_function("document.querySelectorAll('#conversation .row').length===4")
   await page.wait_for_function("!document.querySelector('#partial')")
   rendered=await page.locator('#conversation').inner_text()
   assert rendered.count('authoritative controlled final')==2,rendered
   journal=json.loads(await page.locator('#evidence').inner_text())['journal']
   seqs=[entry['seq'] for entry in journal]
   assert seqs==list(range(len(seqs))),seqs
   assert all(entry['type']=='event' for entry in journal),journal
   starts=[f for f in frames if f['value']['type']=='snapshot']
   assert all(f['value']['assistantStream']['revision']>=0 for f in starts)
   assert all(f['value']['projections']['asOfSeq']==f['value']['cursor'] for f in starts)
   live=[f['value']['frame'] for f in frames if f['value']['type']=='assistant-stream']
   assert [f['revision'] for f in live]==list(range(1,len(live)+1)),live
   assert [f['index'] for f in live if f['type']=='chunk']==list(range(len([f for f in live if f['type']=='chunk'])))
   assert live[-1]['type']=='end' and live[-1]['outcome']['kind']=='committed',live
   await page.wait_for_function("!document.querySelector('#rewind').disabled")
   await page.locator('#rewind').click()
   await page.wait_for_function("document.querySelector('#status').textContent.includes('invalidated')")
  assert await page.locator('#conversation').inner_text()==''
  assert await page.locator('#draft').input_value()=='Unsent independent fixture draft'
  # Public final release and a fresh same-ID controller/Conversation binding. No in-place resync.
  await page.locator('#reopen').click()
  await page.wait_for_function("document.querySelector('#status').textContent.startsWith('Ready')")
  final=json.loads(await page.locator('#evidence').inner_text())
  assert final['sessionId']==native_id
  assert final['generation']!=initial['generation']
  assert await page.locator('#draft').input_value()=='Unsent independent fixture draft'
  if os.environ.get('LIVE_MODE')!='first-materialization':
   assert 'authoritative controlled final' not in await page.locator('#conversation').inner_text()
  by_stream={}
  for frame in frames:
   if frame['value']['type']=='snapshot':by_stream[frame['streamId']]=by_stream.get(frame['streamId'],0)+1
  assert all(count==1 for count in by_stream.values()),by_stream
  assert not errors,errors
  output=Path('vendor/live-evidence');output.mkdir(exist_ok=True)
  mode=os.environ.get('LIVE_MODE','stable')
  await page.screenshot(path=str(output/(mode+'.png')),full_page=True)
  print(json.dumps({'status':'PASS','mode':mode,'nativeIdentityPreserved':True,
    'physicalSnapshots':len(by_stream),'frames':len(frames),'draft':'independent DOM fixture only',
    'durability':'not_attested','provider':'controlled-in-process-not-real-AI'}))
  await browser.close()
asyncio.run(main())
