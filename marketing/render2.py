"""TSUKIPAD explainer -- 1:1 square, 16s, 150 BPM (bar = 1.6s).

Companion to the manifesto trailer, not a recut of it: square so it eats more
vertical space in the X feed, faster, and it walks the actual create flow from
web/app/create/page.tsx instead of making a claim.

Same design tokens as web/app/globals.css. Curves are polygon strokes, not
Pillow line joints -- see stroke_poly.
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

W = H = 1080
FPS, BAR = 30, 1.6
DUR = BAR * 10
NFRAMES = int(DUR * FPS)
OUT = 'frames2'

VOID=(8,8,10); SURFACE=(18,18,22); SURF2=(26,26,32); LINE=(44,44,53); LINEBR=(67,67,79)
LIME=(200,255,46); LIMEDIM=(147,191,31); PINK=(255,61,139); CYAN=(41,229,245); AMBER=(255,176,32)
INK=(244,244,240); MUTED=(140,140,153); FAINT=(91,91,104)

F='fonts/'
sg  = lambda s: ImageFont.truetype(F+'sg-bold.ttf', s)
sgm = lambda s: ImageFont.truetype(F+'sg-med.ttf', s)
jb  = lambda s: ImageFont.truetype(F+'jb-bold.ttf', s)
jbr = lambda s: ImageFont.truetype(F+'jb-reg.ttf', s)
JP  = lambda s: ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', s, index=0)

def clamp(x,a=0.0,b=1.0): return max(a,min(b,x))
def out_expo(x):  x=clamp(x); return 1-2**(-10*x) if x<1 else 1
def out_cubic(x): return 1-(1-clamp(x))**3
def out_back(x):
    x=clamp(x); c=1.9
    return 1+(c+1)*(x-1)**3+c*(x-1)**2
def mix(c0,c1,k):
    k=clamp(k); return tuple(int(a+(b-a)*k) for a,b in zip(c0,c1))

def stroke_poly(pts, w, cap='square'):
    n=len(pts)
    if n<2: return []
    hw=w/2.0; tan=[]
    for i in range(n):
        if i==0:     dx,dy=pts[1][0]-pts[0][0],   pts[1][1]-pts[0][1]
        elif i==n-1: dx,dy=pts[-1][0]-pts[-2][0], pts[-1][1]-pts[-2][1]
        else:        dx,dy=pts[i+1][0]-pts[i-1][0], pts[i+1][1]-pts[i-1][1]
        L=math.hypot(dx,dy) or 1.0; tan.append((dx/L,dy/L))
    P=list(pts)
    if cap=='square':
        P[0]=(P[0][0]-tan[0][0]*hw,   P[0][1]-tan[0][1]*hw)
        P[-1]=(P[-1][0]+tan[-1][0]*hw,P[-1][1]+tan[-1][1]*hw)
    left =[(P[i][0]-tan[i][1]*hw, P[i][1]+tan[i][0]*hw) for i in range(n)]
    right=[(P[i][0]+tan[i][1]*hw, P[i][1]-tan[i][0]*hw) for i in range(n)]
    return left+right[::-1]

def aa_stroke(im, pts, w, color, ss=3):
    if len(pts)<2: return
    pad=w+6
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    x0,y0=int(min(xs)-pad),int(min(ys)-pad); x1,y1=int(max(xs)+pad),int(max(ys)+pad)
    lw,lh=max(1,x1-x0),max(1,y1-y0)
    lay=Image.new('RGBA',(lw*ss,lh*ss),(0,0,0,0)); ld=ImageDraw.Draw(lay)
    ld.polygon(stroke_poly([((p[0]-x0)*ss,(p[1]-y0)*ss) for p in pts], w*ss), fill=tuple(color)+(255,))
    lay=lay.resize((lw,lh),Image.LANCZOS); im.paste(lay,(x0,y0),lay)

def make_ground():
    g=Image.new('RGB',(W,H),VOID); d=ImageDraw.Draw(g)
    for k in range(-H,W+H,3): d.line([(k,0),(k+H,H)],fill=(11,11,13),width=1)
    return g
GROUND=make_ground()

def brut(d,box,fill=SURFACE,border=LINE,bw=2,shadow=LINE,off=8):
    x0,y0,x1,y1=box
    if off: d.rectangle([x0+off,y0+off,x1+off,y1+off],fill=shadow)
    d.rectangle([x0,y0,x1,y1],fill=fill,outline=border,width=bw)

def tsize(d,s,f):
    b=d.textbbox((0,0),s,font=f); return b[2]-b[0],b[3]-b[1],b[0],b[1]

def ctext(d,cx,y,s,f,fill=INK,mid=False):
    w,h,ox,oy=tsize(d,s,f)
    d.text((cx-w/2-ox,(y-h/2 if mid else y)-oy),s,font=f,fill=fill); return w,h

def logomark(im,cx,cy,size,draw_frac=1.0):
    SS=4; s=size/52.0; ls=s*SS; side=int(52*ls)
    lay=Image.new('RGBA',(side,side),(0,0,0,0)); d=ImageDraw.Draw(lay)
    P=lambda x,y:(x*ls,y*ls)
    d.rectangle([*P(6,6),*P(50,50)],fill=LIMEDIM+(255,))
    d.rectangle([*P(2,2),*P(46,46)],fill=LIME+(255,),outline=VOID+(255,),width=max(1,int(2.5*ls)))
    pts=[]
    for i in range(81):
        u=i/80.0
        bx=(1-u)**3*8+3*(1-u)**2*u*22+3*(1-u)*u**2*31+u**3*38
        by=(1-u)**3*39+3*(1-u)**2*u*39+3*(1-u)*u**2*34+u**3*10
        pts.append(P(bx,by))
    n=max(2,int(len(pts)*clamp(draw_frac)))
    poly=stroke_poly(pts[:n],6.5*ls,'square')
    if poly: d.polygon(poly,fill=VOID+(255,))
    if draw_frac>0.93: d.rectangle([*P(33,6),*P(42,15)],fill=VOID+(255,))
    d.rectangle([*P(6,36),*P(12,42)],fill=PINK+(255,))
    out=int(52*s); lay=lay.resize((out,out),Image.LANCZOS)
    im.paste(lay,(int(cx-out/2),int(cy-out/2)),lay)

def chrome(im,d,step):
    """Persistent brand + step pips, so the square never looks like a bare slide."""
    logomark(im,96,86,52)
    d.text((140,66),'TSUKIPAD',font=sg(34),fill=INK)
    for i in range(3):
        x=W-250+i*62
        on = i <= step
        d.rectangle([x,78,x+46,86],fill=LIME if on else LINE)

def curve_pts(x0,y0,x1,y1,n=180):
    out=[]
    for i in range(n+1):
        u=i/n
        out.append((x0+(x1-x0)*u, y0-(y0-y1)*(u**3.1)))
    return out

# --- scenes ---------------------------------------------------------------
def s_title(im,d,t):                                  # bar 0
    logomark(im,W/2,H/2-140,220,draw_frac=clamp(t/0.7))
    if t>0.45:
        k=out_back((t-0.45)/0.45)
        f=sg(int(96*(0.86+0.14*k)))
        ctext(d,W/2,H/2+70,'HOW IT WORKS',f,fill=INK,mid=True)
    if t>0.85:
        ctext(d,W/2,H/2+160,'THREE STEPS. ONE TRANSACTION.',jbr(30),
              fill=mix(VOID,MUTED,out_expo((t-0.85)/0.5)),mid=True)

def step_head(im,d,t,num,title,step):
    chrome(im,d,step)
    a=out_expo(t/0.35); dx=int((1-a)*-60)
    d.text((90+dx,210),f'STEP {num}',font=jb(40),fill=LIME)
    k=out_back(clamp(t/0.5))
    d.text((90+dx,270),title,font=sg(int(104*(0.9+0.1*k))),fill=INK)

def s_name(im,d,t):                                   # bars 1-2
    step_head(im,d,t,'01','NAME IT.',0)
    if t<0.45: return
    a=out_back(clamp((t-0.45)/0.5))
    x0,y0,x1,y1=90,440,W-90,830
    brut(d,[x0,y0,x1,y1],fill=SURFACE,border=LINEBR,off=int(10*a))
    rows=[('NAME','MOON DOGE',0.75),('TICKER','MDOGE',1.35)]
    for i,(lab,val,st) in enumerate(rows):
        ry=y0+56+i*118
        d.text((x0+40,ry),lab,font=jbr(26),fill=FAINT)
        if t>st:
            n=int(len(val)*clamp((t-st)/0.55))       # typed in, character by character
            d.text((x0+40,ry+38),val[:n],font=sg(64),fill=INK)
            if (t*3)%1<0.5 and n<len(val):
                cw=d.textlength(val[:n],font=sg(64))
                d.rectangle([x0+40+cw+6,ry+44,x0+40+cw+22,ry+96],fill=LIME)
    if t>2.35:
        ctext(d,W/2,900,'name, ticker, image. that is the form.',jbr(28),
              fill=mix(VOID,MUTED,out_expo((t-2.35)/0.5)),mid=True)

def s_fund(im,d,t):                                   # bars 3-4
    step_head(im,d,t,'02','PRICE IT.',1)
    if t<0.45: return
    a=out_back(clamp((t-0.45)/0.5))
    x0,y0,x1,y1=90,440,W-90,830
    brut(d,[x0,y0,x1,y1],fill=SURF2,border=LIME,off=int(10*a))
    d.text((x0+40,y0+44),'OPENING MARKET CAP',font=jbr(26),fill=LIMEDIM)
    if t>0.8:
        ctext(d,W/2,y0+180,'$3,000',sg(150),fill=INK,mid=True)
        ctext(d,W/2,y0+280,'NOBODY CAN BUY IN LOWER',jbr(30),fill=FAINT,mid=True)
    if t>1.7:
        ctext(d,W/2,900,'no presale. no seed. no team allocation.',jbr(28),
              fill=mix(VOID,MUTED,out_expo((t-1.7)/0.5)),mid=True)
    if t>2.4:
        ctext(d,W/2,960,'you pay nothing. supply becomes the liquidity.',jb(30),
              fill=mix(VOID,LIME,out_expo((t-2.4)/0.5)),mid=True)

def s_live(im,d,t):                                   # bars 5-6
    step_head(im,d,t,'03',"IT'S LIVE.",2)
    if t<0.45: return
    a=out_back(clamp((t-0.45)/0.5))
    x0,y0,x1,y1=90,440,W-90,830
    brut(d,[x0,y0,x1,y1],fill=SURFACE,border=CYAN,off=int(10*a))
    if t>0.75:
        ctext(d,W/2,y0+90,'UNISWAP V3',sg(88),fill=CYAN,mid=True)
        ctext(d,W/2,y0+180,'USDC POOL',sg(88),fill=CYAN,mid=True)
    if t>1.5:                                          # the stamp lands hard
        k=out_back(clamp((t-1.5)/0.4))
        bw,bh=int(420*k),84
        brut(d,[W/2-bw/2,y0+270,W/2+bw/2,y0+270+bh],fill=VOID,border=PINK,off=7)
        if k>0.75: ctext(d,W/2,y0+270+bh/2,'LP BURNED',jb(44),fill=PINK,mid=True)
    if t>2.3:
        ctext(d,W/2,920,'nobody can pull it. not even you.',jbr(28),
              fill=mix(VOID,MUTED,out_expo((t-2.3)/0.5)),mid=True)

def s_payoff(im,d,t):                                 # bars 7-8
    chrome(im,d,2)
    gx0,gy0,gx1,gy1=110,820,W-190,340
    d.rectangle([gx0,gy0,W-110,gy0+3],fill=LINE)
    for k in range(1,5):
        y=gy0-(gy0-gy1)*k/4.5
        d.line([(gx0,y),(W-110,y)],fill=(24,24,30),width=2)
    pts=curve_pts(gx0,gy0,gx1,gy1)
    n=max(2,int(len(pts)*out_cubic(t/1.9)))
    seg=pts[:n]; aa_stroke(im,seg,10,LIME)
    hx,hy=seg[-1]
    d.rectangle([hx-12,hy-12,hx+12,hy+12],fill=LIME,outline=VOID,width=3)
    d.rectangle([gx0-8,gy0-8,gx0+8,gy0+8],fill=PINK)
    if t>0.3:
        ctext(d,W/2,220,'EVERY TOKEN WALKS THE SAME CURVE',jbr(30),
              fill=mix(VOID,MUTED,out_expo((t-0.3)/0.5)),mid=True)
    if t>2.0:
        ctext(d,W/2,930,"THAT'S THE WHOLE THING.",sg(70),
              fill=mix(VOID,INK,out_expo((t-2.0)/0.5)),mid=True)

def s_end(im,d,t):                                    # bar 9
    logomark(im,W/2,H/2-230,150)
    f=sg(96)
    tot=d.textlength('TSUKI',font=f)+d.textlength('PAD',font=f)
    x=W/2-tot/2-34
    d.text((x,H/2-95),'TSUKI',font=f,fill=INK)
    d.text((x+d.textlength('TSUKI',font=f),H/2-95),'PAD',font=f,fill=LIME)
    d.text((x+tot+22,H/2-80),'月',font=JP(62),fill=LIMEDIM)
    if t>0.25:
        ctext(d,W/2,H/2+70,'tsukipad.com',sg(76),fill=INK,mid=True)
    if t>0.45:
        ctext(d,W/2,H/2+160,'@tsukipadhq',jb(40),fill=LIME,mid=True)
    if t>0.65:
        ctext(d,W/2,H-150,'BUILT ON ARC NETWORK',jbr(28),fill=MUTED,mid=True)
        ctext(d,W/2,H-100,'Arc is a trademark of Circle Internet Group, Inc.',jbr(19),fill=(78,78,90),mid=True)
        ctext(d,W/2,H-72,'Not affiliated with or endorsed by Circle.',jbr(19),fill=(78,78,90),mid=True)

SCENES=[(0,s_title),(1,s_name),(3,s_fund),(5,s_live),(7,s_payoff),(9,s_end)]

def render(t):
    im=GROUND.copy(); d=ImageDraw.Draw(im)
    bar=int(t/BAR); start,fn=SCENES[0]
    for s,f in SCENES:
        if bar>=s: start,fn=s,f
    fn(im,d,t-start*BAR)
    for s,_ in SCENES:                                 # cut flashes
        dt=t-s*BAR
        if 0<=dt<0.08 and s in (7,9):
            ov=Image.new('RGB',(W,H),LIME if s==9 else INK)
            im=Image.blend(im,ov,0.26*(1-dt/0.08))
    if t<0.3:      im=Image.blend(Image.new('RGB',(W,H),VOID),im,out_cubic(t/0.3))
    if t>DUR-0.35: im=Image.blend(im,Image.new('RGB',(W,H),VOID),out_cubic((t-(DUR-0.35))/0.35))
    return im

os.makedirs(OUT,exist_ok=True)
for i in range(NFRAMES):
    render(i/FPS).save(f'{OUT}/f{i:04d}.png')
    if i%80==0: print(f'  {i}/{NFRAMES}')
print('frames done:',NFRAMES)
