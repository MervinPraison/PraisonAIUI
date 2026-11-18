function l(n){const t=[];let e="",s;for(const r of n.split(`
`)){if(!r.startsWith("data:"))continue;let i;try{i=JSON.parse(r.slice(5).trim())}catch{continue}if(!i||typeof i!="object")continue;const{type:a,content:c,token:f,message_id:o}=i;a==="message"&&typeof c=="string"&&c.trim()?(e&&(o===void 0||o!==s)&&t.push(e),e="",t.push(c)):a==="token"&&typeof f=="string"&&(e&&o!==s&&(t.push(e),e=""),s=o,e+=f)}return e&&t.push(e),t.join(`

`).trim()}let p=null;function m(){return p??=fetch("/welcome",{method:"POST",credentials:"same-origin",headers:{Accept:"text/event-stream"}}).then(n=>n.ok?n.text():"").then(l).catch(()=>""),p}export{m as fetchWelcome,l as parseWelcomeStream};
