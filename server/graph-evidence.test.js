import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceProvider,evidenceFields,evidenceTitle,evidenceHighlights} from '../src/graph-evidence.js';

test('a Nosana image running in Daytona is attributed to Daytona execution',()=>{
  const run={entityId:'run-1',labels:['PocketLabNode','ExperimentRun'],evidence:{provider:'Daytona',status:'completed',image:'docker.io/nosana/pytorch-jupyter:2.0.0',exitCode:0,violations:0,profit_usd:0}};
  assert.equal(evidenceProvider(run),'daytona');assert.match(evidenceTitle(run),/Daytona.*measured/);
  const receipt=Object.fromEntries(evidenceFields(run));assert.equal(receipt['Exit code'],0);assert.equal(receipt['Constraint violations'],0);assert.equal(receipt['Measured profit'],'$0.0000');
  assert.equal(evidenceProvider({labels:['Paper'],evidence:{provider:'Nosana'}}),null);
});
test('null database metrics on failed attempts do not appear as measured zeroes',()=>{
  const run={entityId:'failed',labels:['ExperimentRun'],evidence:{provider:'Daytona',status:'failed',profit_usd:null,baseline_profit_usd:null,delta_usd:null,violations:null,exitCode:null,execution_time_sec:null}};
  const receipt=Object.fromEntries(evidenceFields(run));assert.equal(receipt['Measured profit'],undefined);assert.equal(receipt['Baseline profit'],undefined);assert.equal(receipt['Change vs. baseline'],undefined);assert.equal(receipt['Constraint violations'],undefined);assert.equal(receipt['Exit code'],undefined);assert.equal(receipt['Execution time'],undefined);assert.deepEqual(evidenceHighlights(run),[]);
});
test('inference is labeled as interpretation and missing receipts are never invented',()=>{
  const run={entityId:'inference-1',labels:['InferenceRun'],evidence:{provider:'Nosana',status:'failed',httpStatus:503,inputChunkIds:['chunk-1']}};
  assert.equal(evidenceProvider(run),'nosana');assert.match(evidenceTitle(run),/inference/);assert.doesNotMatch(evidenceTitle(run),/measured/);
  const receipt=Object.fromEntries(evidenceFields(run));assert.equal(receipt['Input passages'],1);assert.equal(receipt['HTTP status'],503);assert.equal(receipt['Request ID'],undefined);assert.equal(receipt['Total tokens'],undefined);
});
