"""Shared brand kit for TSUKIPAD motion pieces.

Tokens are copied from web/app/globals.css and the mark from
components/Logo.tsx -- if either changes in the app, change it here too.
render.py and render2.py predate this module and still carry their own copies;
new pieces should import from here.
"""
import math
from PIL import Image, ImageDraw, ImageFont

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
def in_cubic(x):  return clamp(x)**3
def out_back(x, c=1.9):
    x=clamp(x); return 1+(c+1)*(x-1)**3+c*(x-1)**2
def mix(c0,c1,k):
    k=clamp(k); return tuple(int(a+(b-a)*k) for a,b in zip(c0,c1))

def stroke_poly(pts, w, cap='square'):
    """Exact stroke outline. Pillow's line(joint='curve') sprays wedges at each
    vertex on a thick stroke; offsetting the centreline avoids that entirely."""
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
    im.paste(lay.resize((lw,lh),Image.LANCZOS),(x0,y0),lay.resize((lw,lh),Image.LANCZOS))

def ground(W,H):
    g=Image.new('RGB',(W,H),VOID); d=ImageDraw.Draw(g)
    for k in range(-H,W+H,3): d.line([(k,0),(k+H,H)],fill=(11,11,13),width=1)
    return g

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
    """components/Logo.tsx LogoMark, 4x oversampled -- the only curved edge."""
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

def curve_pts(x0,y0,x1,y1,n=180):
    return [(x0+(x1-x0)*(i/n), y0-(y0-y1)*((i/n)**3.1)) for i in range(n+1)]

TRADEMARK = ('Arc is a trademark of Circle Internet Group, Inc.',
             'This project is not affiliated with or endorsed by Circle.')
