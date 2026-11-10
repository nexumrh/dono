"""Gera os áudios do treinamento (voz neural feminina, a mesma dos vídeos do NEXUM RH).
Roda no GitHub Actions quando audio/roteiro.json muda. Saída: audio/<id>.mp3 + audio/versao.json"""
import asyncio, json, os, hashlib
import edge_tts

PASTA = os.path.dirname(os.path.abspath(__file__))
VOZ = os.environ.get('VOZ', 'pt-BR-ThalitaMultilingualNeural')
roteiro = json.load(open(os.path.join(PASTA, 'roteiro.json'), encoding='utf-8'))
vpath = os.path.join(PASTA, 'versao.json')
versao = json.load(open(vpath, encoding='utf-8')) if os.path.exists(vpath) else {}

async def main():
    novo = {}
    for item in roteiro:
        h = hashlib.md5((VOZ + item['texto']).encode()).hexdigest()[:10]
        mp3 = os.path.join(PASTA, item['id'] + '.mp3')
        if versao.get(item['id'], {}).get('h') != h or not os.path.exists(mp3):
            await edge_tts.Communicate(item['texto'], VOZ, rate='+0%').save(mp3)
            print('gerado', item['id'])
        novo[item['id']] = {'h': h, 'texto': item['texto']}
    json.dump(novo, open(vpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

asyncio.run(main())
