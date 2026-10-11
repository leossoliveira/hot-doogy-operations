import test from 'node:test';import assert from 'node:assert/strict';import {recipeDetailTabs} from '../src/recipe-detail-ui.js';
test('version history renders recorded versions and escapes notes without changing selected tab',()=>{
const html=recipeDetailTabs({components:[],versions:[{id:'two',version:2,status:'active',notes:'<script>'},{id:'one',version:1,status:'archived'}],versionId:'two'},()=>'', '');
assert.match(html,/Version history/);assert.match(html,/2 · Current/);assert.match(html,/archived/);assert.match(html,/&lt;script&gt;/);assert.match(html,/id="recipe-panel-history"[^>]*hidden/);
});
