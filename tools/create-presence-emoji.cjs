// Animate the existing brand artwork without redrawing or modifying the app.
// Run with PRESENCE_GRAPHICS_MODULES pointing to a runtime containing sharp and @napi-rs/canvas.
const fs = require('node:fs');
const path = require('node:path');
const modules = process.env.PRESENCE_GRAPHICS_MODULES;
const graphics = name => modules ? require(path.join(modules, name)) : require(name);
const sharp = graphics('sharp');
const { createCanvas, loadImage } = graphics('@napi-rs/canvas');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'assets', 'emoji');
const smoothWebP = process.argv.includes('--smooth');
const size = 256, count = smoothWebP ? 144 : 60, delay = 40;
const delays = Array.from({length:count},(_,index)=>smoothWebP ? (index%3===1 ? 16 : 17) : delay);
const keys = [
  [0,0,1,1,0], [.12,5,1.04,.96,-2], [.32,-17,.98,1.02,5],
  [.48,0,1,1,-2], [.58,3,1.04,.96,0], [.70,0,1,1,0], [1,0,1,1,0]
];
const smooth = x => x*x*(3-2*x);
function pose(t) {
  const i = keys.findIndex((key,index) => index && t <= key[0]);
  const a=keys[i-1],b=keys[i],v=smooth((t-a[0])/(b[0]-a[0]));
  return a.slice(1).map((value,index)=>value+(b[index+1]-value)*v);
}
function star(ctx,x,y,r,alpha) {
  ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle='#83b4ff';ctx.beginPath();
  for(let i=0;i<8;i++){const a=i*Math.PI/4-Math.PI/2,d=i%2?r*.3:r;ctx.lineTo(x+Math.cos(a)*d,y+Math.sin(a)*d);}
  ctx.closePath();ctx.fill();ctx.restore();
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const logo = await loadImage(path.join(root,'assets','images','presence-logo.png'));
  const frames=[],smallFrames=[],emojiFrames=[];let poster;
  for(let index=0;index<count;index++) {
    const t=index/count,canvas=createCanvas(size,size),ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,size,size);
    const pulse=Math.max(0,Math.min(1,(t-.30)/.35));
    if(t>=.30&&t<.65){ctx.strokeStyle=`rgba(61,145,255,${.42*(1-pulse)})`;ctx.lineWidth=4*(1-pulse)+1;ctx.beginPath();ctx.arc(128,132,80+34*pulse,0,Math.PI*2);ctx.stroke();}
    const [y,sx,sy,angle]=pose(t);
    ctx.save();ctx.translate(128,130+y);ctx.rotate(angle*Math.PI/180);ctx.scale(sx,sy);ctx.drawImage(logo,-115,-115,230,230);ctx.restore();
    const badgeIn=smooth(Math.max(0,Math.min(1,(t-.40)/.16)));
    const badgeOut=1-smooth(Math.max(0,Math.min(1,(t-.82)/.13)));
    const badge=badgeIn*badgeOut;
    if(badge>0){
      ctx.save();ctx.globalAlpha=badge;ctx.translate(201,195);ctx.scale(.55+.45*badge,.55+.45*badge);
      ctx.fillStyle='#169b68';ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,23,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#ffffff';ctx.lineWidth=5;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(-10,0);ctx.lineTo(-3,7);ctx.lineTo(11,-8);ctx.stroke();ctx.restore();
      star(ctx,43,54,9,badge);star(ctx,219,63,6,badge*.8);
    }
    frames.push(Buffer.from(ctx.getImageData(0,0,size,size).data));
    if(index%2===0){const small=createCanvas(128,128),smallContext=small.getContext('2d');smallContext.drawImage(canvas,0,0,128,128);smallFrames.push(Buffer.from(smallContext.getImageData(0,0,128,128).data));}
    if(smoothWebP){const small=createCanvas(128,128),smallContext=small.getContext('2d');smallContext.drawImage(canvas,0,0,128,128);emojiFrames.push(Buffer.from(smallContext.getImageData(0,0,128,128).data));}
    if(index===35)poster=canvas.toBuffer('image/png');
  }
  const renderSize=smoothWebP?128:size;
  const input={raw:{width:renderSize,height:renderSize*count,channels:4,pageHeight:renderSize}};
  const pixels=Buffer.concat(smoothWebP?emojiFrames:frames);
  const webpName=smoothWebP ? 'presence-check-in-smooth.webp' : 'presence-check-in.webp';
  await sharp(pixels,input).webp({loop:0,delay:delays,quality:90,effort:5,alphaQuality:100}).toFile(path.join(output,webpName));
  if(!smoothWebP){
  await sharp(pixels,input).gif({loop:0,delay:delays,colours:128,dither:0,effort:7}).toFile(path.join(output,'presence-check-in.gif'));
  fs.writeFileSync(path.join(output,'presence-check-in.png'),poster);
  await sharp(Buffer.concat(smallFrames),{raw:{width:128,height:128*smallFrames.length,channels:4,pageHeight:128}})
    .gif({loop:0,delay:Array(smallFrames.length).fill(delay*2),effort:7,colours:64,dither:0}).toFile(path.join(output,'presence-check-in-128.gif'));
  }
  for(const name of smoothWebP ? [webpName] : ['presence-check-in.gif',webpName,'presence-check-in-128.gif']){
    const file=path.join(output,name),meta=await sharp(file,{animated:true}).metadata();
    if(meta.pages<2||meta.loop!==0||!meta.hasAlpha||meta.delay.reduce((a,b)=>a+b,0)!==2400)throw Error(`Invalid animation: ${name}`);
    console.log(JSON.stringify({file,width:meta.width,height:meta.pageHeight,frames:meta.pages,loop:meta.loop,durationMs:meta.delay.reduce((a,b)=>a+b,0),bytes:fs.statSync(file).size}));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
