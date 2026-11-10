import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('scrolling leaves header height and page spacing stable without layout reads',()=>{
  const source=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=source.indexOf('  function navBehaviour()');
  const end=source.indexOf('\n  /*',start);
  const events=new Map(),frames=[],classes=new Map(),offsets=[];
  let reads=0,height=70;
  const nav={classList:{toggle:(name,on)=>classes.set(name,on)},getBoundingClientRect:()=>{reads++;return {height};}};
  const window={scrollY:0,addEventListener:(name,fn,options)=>{assert.equal(options.passive,true);events.set(name,fn);}};
  vm.runInNewContext(source.slice(start,end)+'\nnavBehaviour();',{
    $:()=>nav,window,document:{documentElement:{style:{setProperty:(name,value)=>offsets.push([name,value])}}},
    requestAnimationFrame:fn=>frames.push(fn)
  });
  for(const y of [390,420,419,421,418,800,799,1200,0]){window.scrollY=y;events.get('scroll')();}
  assert.equal(frames.length,1,'scroll events share one pending frame');
  frames.shift()();
  assert.equal(reads,1,'scroll never measures layout');
  assert.deepEqual(offsets,[['--nav-h','70px']],'scroll never changes hero or rail spacing');
  assert.equal(classes.has('is-hidden'),false,'small direction changes cannot move the header');
  window.scrollY=800;events.get('scroll')();frames.shift()();
  assert.equal(classes.get('is-stuck'),true);
  height=76;events.get('resize')();assert.deepEqual(offsets.at(-1),['--nav-h','76px']);
});

test('menus, the finder and search use subcategory ids and names from child records', () => {
  const pub = fs.readFileSync(new URL('../cms/public.js', import.meta.url), 'utf8');
  const finder = fs.readFileSync(new URL('../cms/finder.js', import.meta.url), 'utf8');
  assert.match(pub, /visibleChildren\(category\)\.map\(c=>\(\{name:c\.name,url:path\(m\.target\)\+'&sub='\+encodeURIComponent\(c\.id\)\}\)\)/, 'submenu links carry the child id');
  assert.doesNotMatch(pub, /\[data-band\]/, 'the retired category band code is gone');
  assert.match(finder, /subcategory=findSubcategory\(cat,subcategory\)\?\.id\|\|''/, '?sub= accepts an id or a name');
  assert.match(finder, /<option value="\$\{esc\(c\.id\)\}"/, 'the subcategory select submits ids');
  assert.match(finder, /\$\$\('\[data-grid\] \.card\[data-product-id\]'\)/, 'filters only touch the product grid, not generated sections');
});
