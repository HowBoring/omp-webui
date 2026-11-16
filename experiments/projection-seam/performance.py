"""Scoped public ClientSessions diagnostic, two warmups + five scored fresh processes per algorithm."""
import argparse, hashlib, json, os, pathlib, platform, shutil, statistics, subprocess, tempfile, time
parser=argparse.ArgumentParser()
parser.add_argument('source',type=pathlib.Path)
parser.add_argument('reviewed_source',type=pathlib.Path)
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args()
root=args.source.resolve()
relative=pathlib.Path('packages/api/session-controller/src/client/sessions/projection-store.ts')
algorithm=root/relative
reviewed=(args.reviewed_source/relative).read_bytes()
assert hashlib.sha256(reviewed).hexdigest()=='d9eb81208e213d1e95275cf6ebe691fc2aa5b0e8b35e8e5c277db69577b8dee3', 'reviewed89f algorithm mismatch'
fixed=algorithm.read_bytes()
node=shutil.which('node')
assert node and subprocess.check_output([node,'--version'],text=True).strip()=='v24.22.1'
driver=root/'packages/api/session-controller/tests/projection-performance-driver.client.spec.ts'
config=root/'projection-performance.vitest.ts'
assert not driver.exists() and not config.exists()
report={'command':[os.sys.executable,str(pathlib.Path(__file__).resolve()),str(args.source.resolve()),str(args.reviewed_source.resolve()),'--output',str(args.output.resolve())],'cwd':str(pathlib.Path.cwd()),
        'scope':'local #40 public ClientSessions staging diagnostic; not #60 product benchmark',
        'fixedSourceTree':json.loads((pathlib.Path(__file__).resolve().parents[2]/'compatibility/dsh/patches.json').read_text())['patches'][-1]['treeAfter'],
        'environment':{'platform':platform.platform(),'node':'24.22.1','cpu':next(line.split(':',1)[1].strip() for line in pathlib.Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')),
                       'logicalCpus':os.cpu_count(),'vitest':json.loads((root/'node_modules/vitest/package.json').read_text())['version'],
                       'storage':subprocess.check_output(['stat','-f','-c','%T',str(root)],text=True).strip(),'memTotal':pathlib.Path('/proc/meminfo').read_text().splitlines()[0],
                       'virtualization':subprocess.run(['systemd-detect-virt'],capture_output=True,text=True).stdout.strip()},
        'input':{'baseline':'one 1,300,000-character U+754C payload; complete baseline 3,900,105 UTF-8 bytes',
                 'updates':'200 sequential title updates control-0-é through control-199-é at seq2..201',
                 'operation':'retain actual Client Session, hold public Remote follow, invalidate, complete typed Remote control baseline then updates through the actual observer; assert rebuilding and no premature publication',
                 'cache':'fresh Vitest fork each sample; filesystem/module caches warm after two unscored runs'},
        'measurement':{'runtime':'one performance.now interval around baseline +200 updates through public typed Remote control and Session-owned observer; no hooks inside production algorithm',
                       'peak':'external /proc/PID/status VmRSS polling every5ms after start marker, plus process OS maxRSS (includes earlier boot high-water)',
                       'steady':'process.memoryUsage after public client.flush, full GC, another public flush and full GC; baseline and last update remain staged',
                       'warmups':2,'scored':5,'gcRequired':True,'order':'reviewed/fixed pairs for each sample, fresh fork every operation batch'},'algorithms':{}}
baseline={'projection':{'source':'synthetic-performance','generation':'next'},'asOfSeq':1,'values':{'payload':'界'*1_300_000}}
updates=[{'type':'projection','sessionId':'projection-performance','projection':baseline['projection'],'seq':index+2,
          'changes':[{'key':'title','val':f'control-{index}-é'}]} for index in range(200)]
corpus=(json.dumps(baseline,ensure_ascii=False,separators=(',',':'))+'\n'+json.dumps(updates,ensure_ascii=False,separators=(',',':'))).encode()
report['input']['sha256']=hashlib.sha256(corpus).hexdigest()
report['input']['serializedCorpusBytes']=len(corpus)
del corpus,baseline,updates
try:
 driver.write_text("import './projection-staging.perf.ts'\n")
 config.write_text("import config from './vitest.config.ts'\nfor (const project of config.test.projects) project.test.execArgv.push('--expose-gc')\nexport default config\n")
 with tempfile.TemporaryDirectory(prefix='projection-perf-') as temporary:
  algorithms=[('reviewed89f',reviewed),('fixed',fixed)]
  for label,code in algorithms:report['algorithms'][label]={'samples':[]}
  for index in range(7):
   for label,code in algorithms:
    algorithm.write_bytes(code)
    samples=report['algorithms'][label]['samples']
    out=pathlib.Path(temporary)/f'{label}-{index}.json'
    with open(str(out)+'.log','w') as log:
     argv=[node,'--expose-gc','node_modules/vitest/vitest.mjs','run',str(driver.relative_to(root)),
           '--config',str(config),'--maxWorkers=1','--reporter=dot']
     load_average=pathlib.Path('/proc/loadavg').read_text().split()[:3]
     available_memory=next(line for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
     process=subprocess.Popen(argv,cwd=root,env={**os.environ,'PROJECTION_PERF_OUTPUT':str(out)},stdout=log,stderr=log)
     peak=0;rss_samples=0
     try:
      while process.poll() is None:
       try:
        if out.exists():
         time.sleep(.005);continue
        pid=json.loads(pathlib.Path(str(out)+'.start').read_text())['pid']
        for line in pathlib.Path(f'/proc/{pid}/status').read_text().splitlines():
         if line.startswith('VmRSS:'):peak=max(peak,int(line.split()[1]));rss_samples+=1
       except (FileNotFoundError,json.JSONDecodeError):pass
       time.sleep(.005)
     finally:
      if process.poll() is None:process.terminate();process.wait(timeout=10)
    if process.returncode:raise RuntimeError(pathlib.Path(str(out)+'.log').read_text()[-4000:])
    result=json.loads(out.read_text());assert result['gcAvailable'] and result['finalPhase']=='rebuilding'
    result.update(sample=index,warmup=index<2,sampledPeakRssKiB=peak,rssSamples=rss_samples,loadAverageAtStart=load_average,availableMemoryAtStart=available_memory)
    samples.append(result)
    print(label,index,round(result['runtimeMs'],3),flush=True)
  for label,code in algorithms:
   samples=report['algorithms'][label]['samples']
   scored=samples[2:]
   report['algorithms'][label]={'sourceFileSha256':hashlib.sha256(code).hexdigest(),'samples':samples,
      'medianRuntimeMs':statistics.median(s['runtimeMs'] for s in scored),
      'maximumRuntimeMs':max(s['runtimeMs'] for s in scored),
      'maximumSampledPeakRssKiB':max(s['sampledPeakRssKiB'] for s in scored),
      'maximumOsHighWaterRssKiB':max(s['maxRssKiB'] for s in scored),
      'medianSteadyRssBytes':statistics.median(s['steady']['rss'] for s in scored),
      'medianSteadyHeapUsedBytes':statistics.median(s['steady']['heapUsed'] for s in scored),
      'medianSteadyExternalBytes':statistics.median(s['steady']['external'] for s in scored),
      'medianSteadyHeapPlusExternalBytes':statistics.median(s['steady']['heapUsed']+s['steady']['external'] for s in scored)}
 report['reviewedSourceTree']='89f725caab557041ab8ad5fb97ce4d296c1f6c92'
 report['limitations']=['RSS is process-wide, including public test-runtime boot; sampled peak includes post-workload GC and settlement. OS high-water can precede measured interval.',
                       'Shared container CPU load is not isolated; adjacent reviewed/fixed pairs and all sample/load data are reported. Five scored local samples locate this changed path; no browser/Host/native latency, product targets, cgroup pressure or Windows claim.',
                       'Both algorithms successfully admit the same input. Only projection-store.ts is substituted; test/runtime/provider/Session control observer and operations are identical; the isolated comparison measures the staging algorithm delta.']
 args.output.write_text(json.dumps(report,indent=2)+'\n')
finally:
 algorithm.write_bytes(fixed)
 driver.unlink(missing_ok=True);config.unlink(missing_ok=True)
