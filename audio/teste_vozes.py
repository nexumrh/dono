import asyncio, edge_tts, os
T='Olá! Este é um teste de voz do treinamento. Vamos aprender a usar o sistema passo a passo.'
async def m():
    vs=[v['ShortName'] for v in await edge_tts.list_voices() if v['Locale']=='pt-BR' or 'Multilingual' in v['ShortName'] and v['Gender']=='Female']
    print(vs)
    os.makedirs('audio/teste',exist_ok=True)
    for v in vs[:14]:
        try: await edge_tts.Communicate(T,v).save(f'audio/teste/{v}.mp3')
        except Exception as e: print(v,e)
asyncio.run(m())
