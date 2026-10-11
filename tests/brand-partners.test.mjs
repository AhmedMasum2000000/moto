import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {load} from 'cheerio';
import {partnerLayout,addPartnerSection} from '../cms/brand-partners.mjs';
import {validateContent} from '../supabase/functions/moto-admin/schema.mjs';

test('short brand lists fill the viewport and loop at a steady speed',()=>{
  for(const count of [1,2,14])for(const viewport of [375,1440,2560]){
    const result=partnerLayout(count,viewport,160,28);
    assert(result.distance>=viewport);
    assert.equal(result.distance,count*188*result.repeats);
    assert.equal(result.duration*32,result.distance);
  }
  assert.equal(partnerLayout(0,1440,160,28).repeats,0);
  assert.equal(partnerLayout(14,0,160,28).distance,0);
});
test('partner section is editable and the migration preserves staff content',()=>{
  const data=JSON.parse(fs.readFileSync(new URL('../cms/initial-content.json',import.meta.url)));
  const before=structuredClone({...data,content:undefined});
  addPartnerSection(data);addPartnerSection(data);validateContent(data);
  assert.deepEqual({...data,content:undefined},before);
  assert.equal(data.content.filter(s=>s.id==='index-brand-partners').length,1);
  assert.equal(data.content[data.content.findIndex(s=>s.id==='index-brand-partners')+1].id,'index-section-5');
  const $=load(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'));
  assert.equal($('main>section').last().attr('id'),'brand-partners');
  assert.equal($('#brand-partners [data-cms-text="home-partner-title"]').length,1);
  assert.equal($('#brand-partners [data-partner-pause]').attr('aria-pressed'),'false');
});
