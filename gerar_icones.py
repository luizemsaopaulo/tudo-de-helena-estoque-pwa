from PIL import Image,ImageDraw,ImageFont
from pathlib import Path
import random
root=Path(r"C:\Users\Luiz\Documents\Projetos\Tudo de Helena\Estoque PWA\assets")
root.mkdir(parents=True,exist_ok=True)
def f(path,size):
    try:return ImageFont.truetype(path,size)
    except:return ImageFont.load_default()
script=f(r"C:\Windows\Fonts\segoesc.ttf",104)
serif=f(r"C:\Windows\Fonts\georgiai.ttf",34)
gold=(177,137,75,255); bg=(244,239,229,255)
def make(size,name,maskable=False):
    s=1024
    im=Image.new("RGBA",(s,s),bg); d=ImageDraw.Draw(im)
    random.seed(7)
    for _ in range(900):
        x=random.randrange(s); y=random.randrange(s); a=random.randrange(7,20)
        col=(185,177,160,a)
        d.ellipse((x,y,x+random.randrange(2,10),y+random.randrange(2,10)),fill=col)
    mask=Image.new("L",(s,s),0); md=ImageDraw.Draw(mask)
    md.rounded_rectangle((28,28,s-28,s-28),radius=(120 if maskable else 180),fill=255)
    out=Image.new("RGBA",(s,s),(0,0,0,0)); out.paste(im,(0,0),mask); d=ImageDraw.Draw(out)
    t="Tudo de Helena"; b=d.textbbox((0,0),t,font=script); d.text(((s-(b[2]-b[0]))//2,365),t,font=script,fill=gold)
    t2="Festas"; b2=d.textbbox((0,0),t2,font=serif); d.text(((s-(b2[2]-b2[0]))//2,525),t2,font=serif,fill=gold)
    out.resize((size,size),Image.Resampling.LANCZOS).save(root/name)
make(192,"icon-192.png")
make(512,"icon-512.png")
make(512,"icon-maskable.png",True)
make(180,"apple-touch-icon.png")
print("icons-ok")
