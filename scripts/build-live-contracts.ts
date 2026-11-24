/** Isolated live acceptance transport validators from the matched native public wire. */
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {makeCommandSchemas} from './command-schemas.ts';
const schema=await Bun.file('vendor/omp/packages/coding-agent/src/modes/rpc/wire/rpc-wire.schema.json').json();
const ajv=new Ajv2020({strict:false,code:{source:true,esm:true}});ajv.addSchema(schema);
const names=['get_state','prompt','abort','navigate_tree','set_event_filter','set_session_name'];
const variants=makeCommandSchemas(schema,names,{maxIdLength:96});
for(const [name,value] of Object.entries({command:{$defs:schema.$defs,anyOf:variants},
  notification:{$ref:`${schema.$id}#/$defs/RpcNotification`},state:{$ref:`${schema.$id}#/$defs/SessionState`}})) {
  const code=standaloneCode(ajv,ajv.compile(value));
  const target=`packages/contracts/generated/live-${name}.js`;
  if(process.argv.includes('--check')){if(await Bun.file(target).text()!==code)throw Error('LIVE_GENERATED_ARTIFACT_STALE');}
  else {await Bun.write(target,code);await Bun.write(target.replace('.js','.d.ts'),'declare const validate: (value: unknown) => boolean;\nexport default validate;\n');}
}
