import test from 'node:test';import assert from 'node:assert/strict';import {recipeDetailTabs} from '../src/recipe-detail-ui.js';
test('version history renders recorded versions and escapes notes without changing selected tab',()=>{
const html=recipeDetailTabs({components:[],versions:[{id:'two',version:2,status:'active',notes:'<script>'},{id:'one',version:1,status:'archived'}],versionId:'two'},()=>'', '');
assert.match(html,/Version history/);assert.match(html,/2 · Current/);assert.match(html,/archived/);assert.match(html,/&lt;script&gt;/);assert.match(html,/id="recipe-panel-history"[^>]*hidden/);
});

test('editing renders separate empty ingredient and packaging groups',()=>{
 const groups=[];const html=recipeDetailTabs({components:[],componentsLoaded:true},(recipe,group)=>{groups.push(group);return `<div id="edit-${group}"></div>`;},'',{editing:true});
 assert.deepEqual(groups,['ingredients','packaging']);assert.match(html,/id="edit-packaging"/);assert.match(html,/id="edit-ingredients"/);
});
