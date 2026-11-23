/** Stock conversation images: a retained Original becomes a real image block, never placeholder text. */
import {expect,test} from 'bun:test';
import {settledHistoryRecords} from '../../packages/projection/history-records.ts';
import {applyHistoryImages, retainedImageMarker} from '../../packages/projection/history-images.ts';
import type {HistoryItem} from '../../packages/contracts/generated/omp-wire.ts';

const objectId='00000000-0000-4000-8000-000000000001';
const image={entryId:'entry-1',objectId,mediaType:'image/png' as const,bytes:70,width:200,height:200,name:'pixel.png'};
const user=(text:string):HistoryItem=>({id:'entry-1',parentId:null,kind:'message',active:false,text,
  role:'user',timestamp:'2023-11-14T22:13:20.123Z'});
const records=(text:string)=>settledHistoryRecords(user(text),'entry-1',10,{turn:0,step:0});

test('a retained image replaces the native placeholder with the stock image block',()=>{
  const projected=applyHistoryImages(records(retainedImageMarker),[image]);
  const message=projected.find(record=>record.type==='event'&&record.event.type==='user/message') as Extract<ReturnType<typeof settledHistoryRecords>[number],{type:'event'}>;
  expect(message.event.data).toMatchObject({id:'entry-1',content:[{type:'image',attachment:{
    attachmentId:objectId,mediaType:'image/png',bytes:70,width:200,height:200,name:'pixel.png'}}]});
});

test('an image with caption keeps its text before the image',()=>{
  const projected=applyHistoryImages(records(`look at this\n${retainedImageMarker}`),[image]);
  const message=projected.find(record=>record.type==='event'&&record.event.type==='user/message') as Extract<ReturnType<typeof settledHistoryRecords>[number],{type:'event'}>;
  expect(message.event.data).toMatchObject({content:[{type:'text',text:'look at this'},
    {type:'image',attachment:{attachmentId:objectId}}]});
});

test('a placeholder without a retained association stays truthful text',()=>{
  const projected=applyHistoryImages(records(retainedImageMarker),[]);
  const message=projected.find(record=>record.type==='event'&&record.event.type==='user/message') as Extract<ReturnType<typeof settledHistoryRecords>[number],{type:'event'}>;
  expect(message.event.data).toMatchObject({content:[{type:'text',text:retainedImageMarker}]});
});

test('another part of the same entry is not given a second copy of the image',()=>{
  const projected=applyHistoryImages(records('continuation text'),[image]);
  const message=projected.find(record=>record.type==='event'&&record.event.type==='user/message') as Extract<ReturnType<typeof settledHistoryRecords>[number],{type:'event'}>;
  expect(message.event.data).toMatchObject({content:[{type:'text',text:'continuation text'}]});
});
