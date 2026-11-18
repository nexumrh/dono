# Gera os vídeos narrados da Central de treinamento a partir dos quadros e do roteiro.
import asyncio, json, os, subprocess, sys
BASE='guia/img'; OUTV='guia/video'; os.makedirs(OUTV, exist_ok=True); os.makedirs('/tmp/aud', exist_ok=True); os.makedirs('/tmp/seg', exist_ok=True)
rot=json.load(open('guia/_roteiro.json'))
VOZES=['pt-BR-FranciscaNeural']
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).decode().strip())
async def falar(txt,out):
    import edge_tts
    for v in VOZES:
        try:
            await edge_tts.Communicate(txt,v,rate='-2%').save(out)
            if os.path.getsize(out)>1000: return
        except Exception as e: print('voz',v,e,flush=True)
    raise RuntimeError('TTS falhou')
async def todas(itens):
    sem=asyncio.Semaphore(6)
    async def um(t,o):
        async with sem:
            if not os.path.exists(o): await falar(t,o)
    await asyncio.gather(*[um(t,o) for t,o in itens])
partes=sys.argv[1:] or list(rot.keys())
for parte in partes:
    secs=rot[parte]; itens=[]
    for s in secs:
        for i,q in enumerate(s['quadros']): itens.append((q['fala'],f"/tmp/aud/{parte}__{q['img']}.mp3"))
    asyncio.run(todas(itens))
    cap={}; t=0.0; lista=[]
    for s in secs:
        cap[s['id']]=round(t,2)
        for q in s['quadros']:
            a=f"/tmp/aud/{parte}__{q['img']}.mp3"; D=dur(a)+0.7; seg=f"/tmp/seg/{parte}__{q['img']}.mp4"
            subprocess.check_call(['ffmpeg','-v','error','-y','-loop','1','-framerate','15','-i',f"{BASE}/{parte}/{q['img']}",'-i',a,
              '-filter_complex',f"[0:v]scale=1280:720:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=0.25[v];[1:a]adelay=250|250,apad,atrim=duration={D:.3f},aresample=44100,aformat=channel_layouts=mono[a]",
              '-map','[v]','-map','[a]','-t',f'{D:.3f}','-c:v','libx264','-preset','veryfast','-tune','stillimage','-crf','27','-r','15','-c:a','aac','-b:a','80k',seg])
            lista.append(seg); t+=dur(seg)
    open('/tmp/lista.txt','w').write(''.join(f"file '{x}'\n" for x in lista))
    subprocess.check_call(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i','/tmp/lista.txt','-c','copy','-movflags','+faststart',f'{OUTV}/{parte}.mp4'])
    json.dump({'duracao':round(t,1),'capitulos':cap},open(f'{OUTV}/{parte}.json','w'))
    print('ok',parte,round(t/60,1),'min',flush=True)
