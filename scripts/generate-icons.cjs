/* OrderLead PWA icon rasterizer: deterministic, dependency-free Node.js.
 * Generates Apple 180px, manifest 192/512px, and safe-zone maskable 512px.
 * Logos are generated at build time, never manually copy binary blobs. */
const fs=require('node:fs')
const path=require('node:path')
const zlib=require('node:zlib')

function crc32(buf){
  let crc=-1
  for(const b of buf){
    crc^=b
    for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)
  }
  return (crc^(-1))>>>0
}
function chunk(type,data){
  const t=Buffer.from(type,'ascii')
  const len=Buffer.alloc(4);len.writeUInt32BE(data.length)
  const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data])))
  return Buffer.concat([len,t,data,crc])
}
function encodePNG(width,height,rgb){
  const scan=Buffer.alloc(height*(width*3+1))
  for(let y=0;y<height;y++){
    const at=y*(width*3+1)
    scan[at]=0
    rgb.copy(scan,at+1,y*width*3,(y+1)*width*3)
  }
  const ihdr=Buffer.alloc(13)
  ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4)
  ihdr[8]=8;ihdr[9]=2
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a','hex'),
    chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(scan,{level:9})),
    chunk('IEND',Buffer.alloc(0))
  ])
}
function paintIcon(size,maskable=false){
  const bytes=Buffer.alloc(size*size*3)
  const scale=maskable?size*0.66/512:size/512
  const offset=maskable?(size-size*0.66)/2:0
  const project=(n)=>Math.round(offset+n*scale)
  function plot(x,y,color){
    if(x<0||y<0||x>=size||y>=size)return
    const p=(y*size+x)*3
    bytes[p]=color[0];bytes[p+1]=color[1];bytes[p+2]=color[2]
  }
  const bg=[7,25,47],inside=[10,34,64],cyan=[38,201,245],blue=[30,142,255],white=[255,255,255]
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)plot(x,y,bg)
  function rounded(x1,y1,x2,y2,r,color){
    const [a,b,c,d,R]=[project(x1),project(y1),project(x2),project(y2),Math.max(1,Math.round(r*scale))]
    for(let y=b;y<d;y++)for(let x=a;x<c;x++){
      const dx=Math.max(a+R-x,0,x-(c-R-1))
      const dy=Math.max(b+R-y,0,y-(d-R-1))
      if(dx*dx+dy*dy<=R*R)plot(x,y,color)
    }
  }
  rounded(0,0,512,512,108,inside)
  rounded(75,258,145,383,15,cyan)
  rounded(171,196,241,383,15,cyan)
  rounded(267,116,337,383,15,blue)
  function disk(cx,cy,r,color){
    const R=Math.max(1,Math.ceil(r*scale)),a=project(cx),b=project(cy)
    for(let y=b-R;y<=b+R;y++)for(let x=a-R;x<=a+R;x++)
      if((x-a)*(x-a)+(y-b)*(y-b)<=R*R)plot(x,y,color)
  }
  function cubic(a,b,c,d,t){
    const s=1-t
    return s*s*s*a+3*s*s*t*b+3*s*t*t*c+t*t*t*d
  }
  // White growth curve separated from chart bars by deep navy outline.
  const trail=[]
  for(let i=0;i<=100;i++){
    const t=i/100
    trail.push([cubic(74,134,180,220,t),cubic(382,347,330,342,t)])
  }
  for(let i=1;i<=140;i++){
    const t=i/140
    trail.push([cubic(220,276,325,405,t),cubic(342,358,294,194,t)])
  }
  for(const [x,y] of trail)disk(x,y,19,inside)
  for(const [x,y] of trail)disk(x,y,12,white)
  function triangle(points,color){
    const q=points.map(([x,y])=>[project(x),project(y)])
    const minY=Math.max(0,Math.min(...q.map(x=>x[1])))
    const maxY=Math.min(size-1,Math.max(...q.map(x=>x[1])))
    for(let y=minY;y<=maxY;y++){
      const intersections=[]
      for(let i=0;i<q.length;i++){
        const [a,b]=q[i],[c,d]=q[(i+1)%q.length]
        if((b<=y&&d>y)||(d<=y&&b>y))intersections.push(a+(y-b)*(c-a)/(d-b))
      }
      intersections.sort((a,b)=>a-b)
      for(let i=0;i+1<intersections.length;i+=2)
        for(let x=Math.max(0,Math.ceil(intersections[i]));x<=Math.min(size-1,Math.floor(intersections[i+1]));x++)plot(x,y,color)
    }
  }
  triangle([[379,174],[453,167],[450,251]],white)
  return encodePNG(size,size,bytes)
}
const dir=path.join(__dirname,'..','public')
fs.mkdirSync(dir,{recursive:true})
for(const [filename,size,mask] of [
  ['icon-192.png',192,false],
  ['icon-512.png',512,false],
  ['apple-touch-icon.png',180,false],
  ['icon-maskable-512.png',512,true]
]){
  const dest=path.join(dir,filename)
  const png=paintIcon(size,mask)
  fs.writeFileSync(dest,png)
  process.stdout.write('Generated '+filename+' '+png.length+' bytes\n')
}
