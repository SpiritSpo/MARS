const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');

const keys={
  demo:'mars-director-presentation-v1',
  working:'mars-working-data-v1',
  legacy:'monarch-im-control-v1',
  archive:'mars-catalog-archive-v1'
};
const fixedNow=Date.parse('2026-11-07T12:00:00.000Z');
class TestDate extends Date {
  constructor(...args){super(...(args.length?args:[fixedNow]));}
  static now(){return fixedNow;}
}
const dist=path.join(__dirname,'..','..','dist');
const source=name=>fs.readFileSync(path.join(dist,name),'utf8');

function demonstrationState(){
  const window={};
  vm.runInNewContext(source('director-demo-data.js'),{window,Date:TestDate});
  return structuredClone(window.MARS_DIRECTOR_DEMO.createState('2026-11-07'));
}

function browser({mode='demo',storage=new Map(),failWrites=false}={}){
  const elements=new Map(),writes=[],attempts=[],messages=[];
  let requestItems=[];
  const control={failWrites};
  const element=()=>({
    innerHTML:'',textContent:'',style:{},value:'',files:[],dataset:{},isConnected:true,
    classList:{add(){},remove(){},contains(){return false;}},
    focus(){},querySelectorAll(){return [];},addEventListener(){},setSelectionRange(){},
    insertAdjacentHTML(){},remove(){}
  });
  const select=s=>{if(!elements.has(s))elements.set(s,element());return elements.get(s);};
  const context=vm.createContext({
    console,structuredClone,Intl,Date:TestDate,Math,crypto:{randomUUID},
    setTimeout(){return 1;},clearTimeout(){},messages,
    document:{
      querySelector:select,getElementById:id=>select('#'+id),
      querySelectorAll:s=>s==='.request-item'?requestItems:[],addEventListener(){},
      body:{style:{}},activeElement:{tagName:'BODY'}
    },
    localStorage:{
      getItem:key=>storage.get(key)??null,
      setItem(key,value){
        attempts.push({key,value:String(value)});
        if(control.failWrites)throw Error('QuotaExceededError');
        writes.push({key,value:String(value)});storage.set(key,String(value));
      }
    },
    window:{scrollTo(){},print(){}},
    FormData:class {
      constructor(form){this.values=form.values;}
      get(key){return this.values[key]??'';}
      has(key){return Object.hasOwn(this.values,key);}
    }
  });
  const run=code=>vm.runInContext(code,context);
  if(mode==='demo')run(source('director-demo-data.js'));
  for(const name of ['workshop.js','accountant.js','app.js']){
    run(name==='app.js'?source(name).replace(/\nrender\(\);\s*$/,''):source(name));
  }
  run('toast=message=>messages.push(message);');
  const json=code=>JSON.parse(run('JSON.stringify('+code+')'));
  return {
    run,json,storage,elements,writes,attempts,messages,control,mode,
    state:()=>json('state'),
    activeKey:()=>run('activeStorageKey'),
    form:selector=>select(selector),
    modalOpen:()=>Boolean(select('#modal-root').innerHTML),
    requestItems(items){requestItems=items.map(item=>({querySelector(selector){
      const name=selector.match(/name="([^"]+)"/)[1];return {value:item[name]};
    }}));},
    submit(form,values){if(values)form.values=values;form.onsubmit({target:form,preventDefault(){}});},
    reload(){return browser({mode,storage});}
  };
}

module.exports={browser,demonstrationState,keys};
