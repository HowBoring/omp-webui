"""Actual Linux Chromium → public DSH root Slot/Remote/Gateway → guarded native RPC.
This is an isolated S0 acceptance page; it never admits product/private Sessions.
"""
import argparse, asyncio, json, os, platform, signal, subprocess, time
from pathlib import Path
from playwright.async_api import async_playwright, expect

async def run(args):
    root=Path(__file__).resolve().parents[2]
    evidence=root/args.evidence;evidence.mkdir(parents=True,exist_ok=True)
    env={"PATH":os.environ.get("PATH","/usr/bin:/bin"),"S0_INTERACTION_PORT":str(args.port)}
    if args.wait_ms is not None:env["S0_INTERACTION_WAIT_MS"]=str(args.wait_ms)
    log=(evidence/"host.log").open("w")
    host=subprocess.Popen([args.bun,"--no-env-file","vendor/host-interactions/interactions-fixture-main.js"],cwd=root,
      env=env,stdout=log,stderr=log,start_new_session=True)
    cases=[];errors=[]
    def passed(name,**facts):cases.append({"case":name,"status":"PASS",**facts})
    try:
      async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox"])
        context=await browser.new_context();await context.tracing.start(screenshots=True,snapshots=True,sources=True)
        first=await context.new_page();first.on("pageerror",lambda error:errors.append(str(error)))
        for _ in range(80):
          try:await first.goto(f"http://127.0.0.1:{args.port}");break
          except Exception:await asyncio.sleep(.1)
        else:raise RuntimeError("S0 Host did not start")
        await expect(first.locator('[data-policy-verified="true"]')).to_be_visible()
        await expect(first.locator('[data-slot="root"] [data-slot="s0.interactions"]')).to_be_visible()
        card=first.locator('[data-interaction-id]');await expect(card).to_have_count(1)
        startup_id=await card.get_attribute("data-interaction-id")
        created=int(await card.get_attribute("data-created-at"));deadline=int(await card.locator('[data-deadline]').get_attribute("data-deadline"))
        expected=args.wait_ms if args.wait_ms is not None else 1_800_000
        assert deadline-created==expected
        await expect(card).to_have_attribute("data-scope","startup")
        await expect(first.get_by_text("Startup context — no Session required")).to_be_visible()
        passed("root-startup-public-Slot-no-Session",defaultWaitMs=expected,interactionId=startup_id)
        await first.reload();await expect(first.locator('[data-interaction-id]')).to_have_attribute("data-interaction-id",startup_id)
        assert int(await first.locator('[data-deadline]').get_attribute('data-deadline'))==deadline
        second=await context.new_page();second.on("pageerror",lambda error:errors.append(str(error)))
        await second.goto(f"http://127.0.0.1:{args.port}");await expect(second.locator('[data-interaction-id]')).to_have_attribute("data-interaction-id",startup_id)
        await first.close();await second.close();await asyncio.sleep(.1)
        first=await context.new_page();first.on("pageerror",lambda error:errors.append(str(error)))
        await first.goto(f"http://127.0.0.1:{args.port}");await expect(first.locator('[data-interaction-id]')).to_have_attribute("data-interaction-id",startup_id)
        assert int(await first.locator('[data-deadline]').get_attribute('data-deadline'))==deadline
        passed("refresh-and-all-viewers-disconnect-never-renew",originalDeadline=deadline)
        await first.get_by_label('Explicit answer').fill('explicit startup')
        await first.get_by_role('button',name='Submit explicit answer',exact=True).press('Enter')
        await expect(first.locator('[data-answer-result]')).to_have_text('answered')
        await expect(first.locator('[data-interaction-id]')).to_have_count(0)
        passed('real-Linux-keyboard-explicit-root-answer')
        await first.get_by_role('button',name='Start ask',exact=True).click()
        await expect(first.locator('[data-interaction-id]')).to_have_count(1)
        await expect(first.locator('[data-interaction-id]')).to_have_attribute('data-scope','session')
        await expect(first.get_by_text('Native Session',exact=False)).to_be_visible()
        second=await context.new_page();second.on('pageerror',lambda error:errors.append(str(error)))
        await second.goto(f'http://127.0.0.1:{args.port}')
        await expect(second.get_by_role('button',name='Deny',exact=True)).to_be_visible()
        await asyncio.gather(first.get_by_role('button',name='Allow',exact=True).click(),
          second.get_by_role('button',name='Deny',exact=True).click())
        await expect(first.locator('[data-interaction-id]')).to_have_count(0)
        await expect(second.locator('[data-interaction-id]')).to_have_count(0)
        results=[await page.locator('[data-answer-result]').inner_text() for page in [first,second]]
        assert sorted(results) in [['answered','stale'],['answered','overloaded']],results
        passed('Session-native-ask-two-page-first-valid',results=results)
        await first.get_by_role('button',name='Start select',exact=True).click()
        await expect(first.get_by_role('button',name='Deny',exact=True)).to_be_visible()
        await first.get_by_role('button',name='Cancel interaction',exact=True).click()
        await expect(first.locator('[data-answer-result]')).to_have_text('cancelled')
        await expect(first.locator('[data-interaction-id]')).to_have_count(0)
        passed('explicit-cancel-is-not-a-default-answer')
        await first.get_by_role('button',name='Start confirm',exact=True).click()
        await expect(first.get_by_text('Explicit confirmation message must be visible',exact=True)).to_be_visible()
        await first.get_by_role('button',name='Deny',exact=True).click()
        await expect(first.locator('[data-answer-result]')).to_have_text('answered')
        await expect(first.locator('[data-interaction-id]')).to_have_count(0)
        passed('native-confirm-false-is-an-explicit-answer')
        await first.get_by_role('button',name='Start multi-ask',exact=True).click()
        await first.get_by_label('North',exact=True).check()
        await first.get_by_label('Red',exact=True).check()
        await first.get_by_label('Blue',exact=True).check()
        await first.get_by_role('button',name='Submit answers',exact=True).click()
        await expect(first.locator('[data-answer-result]')).to_have_text('answered')
        await expect(first.locator('[data-interaction-id]')).to_have_count(0)
        passed('native-ask-distinct-question-order-and-multiselect')
        await first.get_by_role('button',name='Start timed-ask',exact=True).click()
        await expect(first.locator('[data-interaction-id]')).to_have_count(1)
        native_id=await first.locator('[data-interaction-id]').get_attribute('data-interaction-id')
        await expect(first.locator('[data-interaction-id]')).to_have_count(0,timeout=5000)
        await expect(first.locator('[data-outcomes]')).to_contain_text('expired')
        passed('real-native-ask-expiry-cancels',interactionId=native_id)
        await first.get_by_role('button',name='Start timed-tool',exact=True).click()
        await expect(first.get_by_role('button',name='chosen',exact=True)).to_be_visible()
        await first.get_by_role('button',name='chosen',exact=True).click()
        await expect(first.get_by_label('Explicit answer')).to_be_visible()
        await expect(first.locator('[data-interaction-id]')).to_have_count(0,timeout=5000)
        await expect(first.locator('[data-outcomes]')).to_contain_text('expired')
        passed('real-native-HTML-form-partial-expiry-no-defaults')
        if args.wait_ms is not None:
          await first.get_by_role('button',name='Start ask',exact=True).click()
          await expect(first.locator('[data-interaction-id]')).to_have_count(1)
          host_id=await first.locator('[data-interaction-id]').get_attribute('data-interaction-id')
          original=await first.locator('[data-deadline]').get_attribute('data-deadline')
          await first.reload();await expect(first.locator('[data-interaction-id]')).to_have_attribute('data-interaction-id',host_id)
          assert await first.locator('[data-deadline]').get_attribute('data-deadline')==original
          await second.close();await first.close();await asyncio.sleep(args.wait_ms/1000+.2)
          first=await context.new_page();first.on('pageerror',lambda error:errors.append(str(error)))
          await first.goto(f'http://127.0.0.1:{args.port}')
          await expect(first.locator('[data-policy-verified="true"]')).to_be_visible()
          await expect(first.locator('[data-interaction-id]')).to_have_count(0)
          await expect(first.locator('[data-outcomes]')).to_contain_text('expired')
          passed('configured-Host-expiry-offline-no-renewal',waitMs=args.wait_ms,interactionId=host_id)
        response=await context.request.post(f'http://127.0.0.1:{args.port}/api/session/open',data={})
        assert response.status==501
        passed('product-Session-admission-remains-blocked')
        assert not errors,errors
        await first.screenshot(path=str(evidence/'root-Slot.png'),full_page=True)
        await context.tracing.stop(path=str(evidence/'trace.zip'))
        version=browser.version;await browser.close()
    finally:
      host.send_signal(signal.SIGTERM)
      try:host.wait(timeout=8)
      except subprocess.TimeoutExpired:os.killpg(host.pid,signal.SIGKILL);host.wait();raise
      log.close()
    assert host.returncode==0,host.returncode
    summary={"status":"PASS","scope":"S0 isolated; not product admission","platform":platform.platform(),
      "browser":version,"cases":cases,"browserErrors":errors,"hostExitCode":host.returncode,
      "OMP":json.loads((root/'packages/contracts/generated/identity.ts').read_text().split(' = ',1)[1].strip().rstrip(';')),
      "Host":json.loads((root/'vendor/host-interactions/manifest.json').read_text()),
      "DSH":json.loads((root/'vendor/dsh-interactions/manifest.json').read_text())}
    (evidence/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps({"status":"PASS","cases":len(cases),"browser":version,"hostExitCode":host.returncode}))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--bun',default=os.environ.get('BUN_EXECUTABLE','bun'))
 parser.add_argument('--port',type=int,default=3183);parser.add_argument('--wait-ms',type=int)
 parser.add_argument('--evidence',default='vendor/interactions-browser');asyncio.run(run(parser.parse_args()))
