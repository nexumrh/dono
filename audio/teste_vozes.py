import asyncio, edge_tts, os
T='Olá! Este é um teste de voz do treinamento. Vamos aprender a usar o sistema passo a passo.'
os.makedirs('audio/teste',exist_ok=True)
try:
    from gtts import gTTS
    gTTS(T, lang='pt', tld='com.br').save('audio/teste/gtts-pt-br.mp3')
except Exception as e: print('gtts', e)
async def m():
    for v in ['pt-PT-RaquelNeural','pt-BR-ThalitaMultilingualNeural']:
        try: await edge_tts.Communicate(T,v).save(f'audio/teste/{v}.mp3')
        except Exception as e: print(v,e)
asyncio.run(m())
