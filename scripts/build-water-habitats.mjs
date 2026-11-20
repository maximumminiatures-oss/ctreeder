import {readFile,writeFile} from 'node:fs/promises';
const source=new URL('../S3_content/data/water-habitats.json',import.meta.url);
const output=new URL('../S3_content/src/water-habitat-data.js',import.meta.url);
const data=JSON.parse(await readFile(source,'utf8'));
await writeFile(output,'// Generated from data/water-habitats.json. Edit the JSON source and regenerate.\nexport default '+JSON.stringify(data,null,2)+';\n');
