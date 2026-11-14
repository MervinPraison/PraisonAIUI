function o(t,n){const a=Math.max(0,...(t.match(/`+/g)??[]).map(s=>s.length)),e="`".repeat(Math.max(3,a+1)),c=/^[\w#+.-]{1,32}$/.test(n)?n:"";return`${e}${c}
${t}
${e}`}export{o as f};
