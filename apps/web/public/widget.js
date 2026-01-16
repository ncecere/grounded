var GroundedWidget=(function(fe){"use strict";var me,w,nt,O,ot,st,at,it,Re,Ae,Ie,oe={},lt=[],nr=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,be=Array.isArray;function j(t,e){for(var r in e)t[r]=e[r];return t}function Ee(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function or(t,e,r){var o,n,s,a={};for(s in e)s=="key"?o=e[s]:s=="ref"?n=e[s]:a[s]=e[s];if(arguments.length>2&&(a.children=arguments.length>3?me.call(arguments,2):r),typeof t=="function"&&t.defaultProps!=null)for(s in t.defaultProps)a[s]===void 0&&(a[s]=t.defaultProps[s]);return _e(t,a,o,n,null)}function _e(t,e,r,o,n){var s={type:t,props:e,key:r,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++nt,__i:-1,__u:0};return n==null&&w.vnode!=null&&w.vnode(s),s}function K(t){return t.children}function xe(t,e){this.props=t,this.context=e}function J(t,e){if(e==null)return t.__?J(t.__,t.__i+1):null;for(var r;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null)return r.__e;return typeof t.type=="function"?J(t):null}function dt(t){var e,r;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null){t.__e=t.__c.base=r.__e;break}return dt(t)}}function ct(t){(!t.__d&&(t.__d=!0)&&O.push(t)&&!ke.__r++||ot!=w.debounceRendering)&&((ot=w.debounceRendering)||st)(ke)}function ke(){for(var t,e,r,o,n,s,a,u=1;O.length;)O.length>u&&O.sort(at),t=O.shift(),u=O.length,t.__d&&(r=void 0,o=void 0,n=(o=(e=t).__v).__e,s=[],a=[],e.__P&&((r=j({},o)).__v=o.__v+1,w.vnode&&w.vnode(r),Me(e.__P,r,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,s,n??J(o),!!(32&o.__u),a),r.__v=o.__v,r.__.__k[r.__i]=r,ft(s,r,a),o.__e=o.__=null,r.__e!=n&&dt(r)));ke.__r=0}function ut(t,e,r,o,n,s,a,u,i,d,g){var c,p,h,f,_,x,m,b=o&&o.__k||lt,S=e.length;for(i=sr(r,e,b,i,S),c=0;c<S;c++)(h=r.__k[c])!=null&&(p=h.__i==-1?oe:b[h.__i]||oe,h.__i=c,x=Me(t,h,p,n,s,a,u,i,d,g),f=h.__e,h.ref&&p.ref!=h.ref&&(p.ref&&Ne(p.ref,null,h),g.push(h.ref,h.__c||f,h)),_==null&&f!=null&&(_=f),(m=!!(4&h.__u))||p.__k===h.__k?i=gt(h,i,t,m):typeof h.type=="function"&&x!==void 0?i=x:f&&(i=f.nextSibling),h.__u&=-7);return r.__e=_,i}function sr(t,e,r,o,n){var s,a,u,i,d,g=r.length,c=g,p=0;for(t.__k=new Array(n),s=0;s<n;s++)(a=e[s])!=null&&typeof a!="boolean"&&typeof a!="function"?(typeof a=="string"||typeof a=="number"||typeof a=="bigint"||a.constructor==String?a=t.__k[s]=_e(null,a,null,null,null):be(a)?a=t.__k[s]=_e(K,{children:a},null,null,null):a.constructor===void 0&&a.__b>0?a=t.__k[s]=_e(a.type,a.props,a.key,a.ref?a.ref:null,a.__v):t.__k[s]=a,i=s+p,a.__=t,a.__b=t.__b+1,u=null,(d=a.__i=ar(a,r,i,c))!=-1&&(c--,(u=r[d])&&(u.__u|=2)),u==null||u.__v==null?(d==-1&&(n>g?p--:n<g&&p++),typeof a.type!="function"&&(a.__u|=4)):d!=i&&(d==i-1?p--:d==i+1?p++:(d>i?p--:p++,a.__u|=4))):t.__k[s]=null;if(c)for(s=0;s<g;s++)(u=r[s])!=null&&(2&u.__u)==0&&(u.__e==o&&(o=J(u)),bt(u,u));return o}function gt(t,e,r,o){var n,s;if(typeof t.type=="function"){for(n=t.__k,s=0;n&&s<n.length;s++)n[s]&&(n[s].__=t,e=gt(n[s],e,r,o));return e}t.__e!=e&&(o&&(e&&t.type&&!e.parentNode&&(e=J(t)),r.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function ar(t,e,r,o){var n,s,a,u=t.key,i=t.type,d=e[r],g=d!=null&&(2&d.__u)==0;if(d===null&&u==null||g&&u==d.key&&i==d.type)return r;if(o>(g?1:0)){for(n=r-1,s=r+1;n>=0||s<e.length;)if((d=e[a=n>=0?n--:s++])!=null&&(2&d.__u)==0&&u==d.key&&i==d.type)return a}return-1}function ht(t,e,r){e[0]=="-"?t.setProperty(e,r??""):t[e]=r==null?"":typeof r!="number"||nr.test(e)?r:r+"px"}function ve(t,e,r,o,n){var s,a;e:if(e=="style")if(typeof r=="string")t.style.cssText=r;else{if(typeof o=="string"&&(t.style.cssText=o=""),o)for(e in o)r&&e in r||ht(t.style,e,"");if(r)for(e in r)o&&r[e]==o[e]||ht(t.style,e,r[e])}else if(e[0]=="o"&&e[1]=="n")s=e!=(e=e.replace(it,"$1")),a=e.toLowerCase(),e=a in t||e=="onFocusOut"||e=="onFocusIn"?a.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+s]=r,r?o?r.u=o.u:(r.u=Re,t.addEventListener(e,s?Ie:Ae,s)):t.removeEventListener(e,s?Ie:Ae,s);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&r==1?"":r))}}function pt(t){return function(e){if(this.l){var r=this.l[e.type+t];if(e.t==null)e.t=Re++;else if(e.t<r.u)return;return r(w.event?w.event(e):e)}}}function Me(t,e,r,o,n,s,a,u,i,d){var g,c,p,h,f,_,x,m,b,S,$,T,q,V,M,R,B,L=e.type;if(e.constructor!==void 0)return null;128&r.__u&&(i=!!(32&r.__u),s=[u=e.__e=r.__e]),(g=w.__b)&&g(e);e:if(typeof L=="function")try{if(m=e.props,b="prototype"in L&&L.prototype.render,S=(g=L.contextType)&&o[g.__c],$=g?S?S.props.value:g.__:o,r.__c?x=(c=e.__c=r.__c).__=c.__E:(b?e.__c=c=new L(m,$):(e.__c=c=new xe(m,$),c.constructor=L,c.render=lr),S&&S.sub(c),c.state||(c.state={}),c.__n=o,p=c.__d=!0,c.__h=[],c._sb=[]),b&&c.__s==null&&(c.__s=c.state),b&&L.getDerivedStateFromProps!=null&&(c.__s==c.state&&(c.__s=j({},c.__s)),j(c.__s,L.getDerivedStateFromProps(m,c.__s))),h=c.props,f=c.state,c.__v=e,p)b&&L.getDerivedStateFromProps==null&&c.componentWillMount!=null&&c.componentWillMount(),b&&c.componentDidMount!=null&&c.__h.push(c.componentDidMount);else{if(b&&L.getDerivedStateFromProps==null&&m!==h&&c.componentWillReceiveProps!=null&&c.componentWillReceiveProps(m,$),e.__v==r.__v||!c.__e&&c.shouldComponentUpdate!=null&&c.shouldComponentUpdate(m,c.__s,$)===!1){for(e.__v!=r.__v&&(c.props=m,c.state=c.__s,c.__d=!1),e.__e=r.__e,e.__k=r.__k,e.__k.some(function(A){A&&(A.__=e)}),T=0;T<c._sb.length;T++)c.__h.push(c._sb[T]);c._sb=[],c.__h.length&&a.push(c);break e}c.componentWillUpdate!=null&&c.componentWillUpdate(m,c.__s,$),b&&c.componentDidUpdate!=null&&c.__h.push(function(){c.componentDidUpdate(h,f,_)})}if(c.context=$,c.props=m,c.__P=t,c.__e=!1,q=w.__r,V=0,b){for(c.state=c.__s,c.__d=!1,q&&q(e),g=c.render(c.props,c.state,c.context),M=0;M<c._sb.length;M++)c.__h.push(c._sb[M]);c._sb=[]}else do c.__d=!1,q&&q(e),g=c.render(c.props,c.state,c.context),c.state=c.__s;while(c.__d&&++V<25);c.state=c.__s,c.getChildContext!=null&&(o=j(j({},o),c.getChildContext())),b&&!p&&c.getSnapshotBeforeUpdate!=null&&(_=c.getSnapshotBeforeUpdate(h,f)),R=g,g!=null&&g.type===K&&g.key==null&&(R=mt(g.props.children)),u=ut(t,be(R)?R:[R],e,r,o,n,s,a,u,i,d),c.base=e.__e,e.__u&=-161,c.__h.length&&a.push(c),x&&(c.__E=c.__=null)}catch(A){if(e.__v=null,i||s!=null)if(A.then){for(e.__u|=i?160:128;u&&u.nodeType==8&&u.nextSibling;)u=u.nextSibling;s[s.indexOf(u)]=null,e.__e=u}else{for(B=s.length;B--;)Ee(s[B]);Be(e)}else e.__e=r.__e,e.__k=r.__k,A.then||Be(e);w.__e(A,e,r)}else s==null&&e.__v==r.__v?(e.__k=r.__k,e.__e=r.__e):u=e.__e=ir(r.__e,e,r,o,n,s,a,i,d);return(g=w.diffed)&&g(e),128&e.__u?void 0:u}function Be(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Be)}function ft(t,e,r){for(var o=0;o<r.length;o++)Ne(r[o],r[++o],r[++o]);w.__c&&w.__c(e,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(s){s.call(n)})}catch(s){w.__e(s,n.__v)}})}function mt(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:be(t)?t.map(mt):j({},t)}function ir(t,e,r,o,n,s,a,u,i){var d,g,c,p,h,f,_,x=r.props||oe,m=e.props,b=e.type;if(b=="svg"?n="http://www.w3.org/2000/svg":b=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),s!=null){for(d=0;d<s.length;d++)if((h=s[d])&&"setAttribute"in h==!!b&&(b?h.localName==b:h.nodeType==3)){t=h,s[d]=null;break}}if(t==null){if(b==null)return document.createTextNode(m);t=document.createElementNS(n,b,m.is&&m),u&&(w.__m&&w.__m(e,s),u=!1),s=null}if(b==null)x===m||u&&t.data==m||(t.data=m);else{if(s=s&&me.call(t.childNodes),!u&&s!=null)for(x={},d=0;d<t.attributes.length;d++)x[(h=t.attributes[d]).name]=h.value;for(d in x)if(h=x[d],d!="children"){if(d=="dangerouslySetInnerHTML")c=h;else if(!(d in m)){if(d=="value"&&"defaultValue"in m||d=="checked"&&"defaultChecked"in m)continue;ve(t,d,null,h,n)}}for(d in m)h=m[d],d=="children"?p=h:d=="dangerouslySetInnerHTML"?g=h:d=="value"?f=h:d=="checked"?_=h:u&&typeof h!="function"||x[d]===h||ve(t,d,h,x[d],n);if(g)u||c&&(g.__html==c.__html||g.__html==t.innerHTML)||(t.innerHTML=g.__html),e.__k=[];else if(c&&(t.innerHTML=""),ut(e.type=="template"?t.content:t,be(p)?p:[p],e,r,o,b=="foreignObject"?"http://www.w3.org/1999/xhtml":n,s,a,s?s[0]:r.__k&&J(r,0),u,i),s!=null)for(d=s.length;d--;)Ee(s[d]);u||(d="value",b=="progress"&&f==null?t.removeAttribute("value"):f!=null&&(f!==t[d]||b=="progress"&&!f||b=="option"&&f!=x[d])&&ve(t,d,f,x[d],n),d="checked",_!=null&&_!=t[d]&&ve(t,d,_,x[d],n))}return t}function Ne(t,e,r){try{if(typeof t=="function"){var o=typeof t.__u=="function";o&&t.__u(),o&&e==null||(t.__u=t(e))}else t.current=e}catch(n){w.__e(n,r)}}function bt(t,e,r){var o,n;if(w.unmount&&w.unmount(t),(o=t.ref)&&(o.current&&o.current!=t.__e||Ne(o,null,e)),(o=t.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(s){w.__e(s,e)}o.base=o.__P=null}if(o=t.__k)for(n=0;n<o.length;n++)o[n]&&bt(o[n],e,r||typeof t.type!="function");r||Ee(t.__e),t.__c=t.__=t.__e=void 0}function lr(t,e,r){return this.constructor(t,r)}function _t(t,e,r){var o,n,s,a;e==document&&(e=document.documentElement),w.__&&w.__(t,e),n=(o=!1)?null:e.__k,s=[],a=[],Me(e,t=e.__k=or(K,null,[t]),n||oe,oe,e.namespaceURI,n?null:e.firstChild?me.call(e.childNodes):null,s,n?n.__e:e.firstChild,o,a),ft(s,t,a)}me=lt.slice,w={__e:function(t,e,r,o){for(var n,s,a;e=e.__;)if((n=e.__c)&&!n.__)try{if((s=n.constructor)&&s.getDerivedStateFromError!=null&&(n.setState(s.getDerivedStateFromError(t)),a=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(t,o||{}),a=n.__d),a)return n.__E=n}catch(u){t=u}throw t}},nt=0,xe.prototype.setState=function(t,e){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=j({},this.state),typeof t=="function"&&(t=t(j({},r),this.props)),t&&j(r,t),t!=null&&this.__v&&(e&&this._sb.push(e),ct(this))},xe.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),ct(this))},xe.prototype.render=K,O=[],st=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,at=function(t,e){return t.__v.__b-e.__v.__b},ke.__r=0,it=/(PointerCapture)$|Capture$/i,Re=0,Ae=pt(!1),Ie=pt(!0);var dr=0;function l(t,e,r,o,n,s){e||(e={});var a,u,i=e;if("ref"in i)for(u in i={},e)u=="ref"?a=e[u]:i[u]=e[u];var d={type:t,props:i,key:r,ref:a,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--dr,__i:-1,__u:0,__source:n,__self:s};if(typeof t=="function"&&(a=t.defaultProps))for(u in a)i[u]===void 0&&(i[u]=a[u]);return w.vnode&&w.vnode(d),d}var se,C,Pe,xt,ae=0,kt=[],z=w,vt=z.__b,wt=z.__r,yt=z.diffed,St=z.__c,$t=z.unmount,Ct=z.__;function Fe(t,e){z.__h&&z.__h(C,t,ae||e),ae=0;var r=C.__H||(C.__H={__:[],__h:[]});return t>=r.__.length&&r.__.push({}),r.__[t]}function I(t){return ae=1,cr(Rt,t)}function cr(t,e,r){var o=Fe(se++,2);if(o.t=t,!o.__c&&(o.__=[Rt(void 0,e),function(u){var i=o.__N?o.__N[0]:o.__[0],d=o.t(i,u);i!==d&&(o.__N=[d,o.__[1]],o.__c.setState({}))}],o.__c=C,!C.__f)){var n=function(u,i,d){if(!o.__c.__H)return!0;var g=o.__c.__H.__.filter(function(p){return!!p.__c});if(g.every(function(p){return!p.__N}))return!s||s.call(this,u,i,d);var c=o.__c.props!==u;return g.forEach(function(p){if(p.__N){var h=p.__[0];p.__=p.__N,p.__N=void 0,h!==p.__[0]&&(c=!0)}}),s&&s.call(this,u,i,d)||c};C.__f=!0;var s=C.shouldComponentUpdate,a=C.componentWillUpdate;C.componentWillUpdate=function(u,i,d){if(this.__e){var g=s;s=void 0,n(u,i,d),s=g}a&&a.call(this,u,i,d)},C.shouldComponentUpdate=n}return o.__N||o.__}function U(t,e){var r=Fe(se++,3);!z.__s&&Lt(r.__H,e)&&(r.__=t,r.u=e,C.__H.__h.push(r))}function G(t){return ae=5,zt(function(){return{current:t}},[])}function zt(t,e){var r=Fe(se++,7);return Lt(r.__H,e)&&(r.__=t(),r.__H=e,r.__h=t),r.__}function He(t,e){return ae=8,zt(function(){return t},e)}function ur(){for(var t;t=kt.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(we),t.__H.__h.forEach(qe),t.__H.__h=[]}catch(e){t.__H.__h=[],z.__e(e,t.__v)}}z.__b=function(t){C=null,vt&&vt(t)},z.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),Ct&&Ct(t,e)},z.__r=function(t){wt&&wt(t),se=0;var e=(C=t.__c).__H;e&&(Pe===C?(e.__h=[],C.__h=[],e.__.forEach(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(e.__h.forEach(we),e.__h.forEach(qe),e.__h=[],se=0)),Pe=C},z.diffed=function(t){yt&&yt(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(kt.push(e)!==1&&xt===z.requestAnimationFrame||((xt=z.requestAnimationFrame)||gr)(ur)),e.__H.__.forEach(function(r){r.u&&(r.__H=r.u),r.u=void 0})),Pe=C=null},z.__c=function(t,e){e.some(function(r){try{r.__h.forEach(we),r.__h=r.__h.filter(function(o){return!o.__||qe(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],z.__e(o,r.__v)}}),St&&St(t,e)},z.unmount=function(t){$t&&$t(t);var e,r=t.__c;r&&r.__H&&(r.__H.__.forEach(function(o){try{we(o)}catch(n){e=n}}),r.__H=void 0,e&&z.__e(e,r.__v))};var Tt=typeof requestAnimationFrame=="function";function gr(t){var e,r=function(){clearTimeout(o),Tt&&cancelAnimationFrame(e),setTimeout(t)},o=setTimeout(r,35);Tt&&(e=requestAnimationFrame(r))}function we(t){var e=C,r=t.__c;typeof r=="function"&&(t.__c=void 0,r()),C=e}function qe(t){var e=C;t.__c=t.__(),C=e}function Lt(t,e){return!t||t.length!==e.length||e.some(function(r,o){return r!==t[o]})}function Rt(t,e){return typeof e=="function"?e(t):e}function hr({token:t,apiBase:e,agenticMode:r=!1,showChainOfThought:o=!1}){const[n,s]=I([]),[a,u]=I(!1),[i,d]=I(!1),[g,c]=I(null),[p,h]=I({status:"idle"}),[f,_]=I([]),x=G(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),m=G(null),b=()=>Math.random().toString(36).slice(2,11),S=He(async q=>{if(console.log("[Grounded Widget] sendMessage called with agenticMode:",r,"showChainOfThought:",o),!q.trim()||a||i)return;const V={id:b(),role:"user",content:q.trim(),timestamp:Date.now()},M=b();s(R=>[...R,V]),u(!0),d(!0),c(null),_([]),r?(console.log("[Grounded Widget] Using AGENTIC mode"),h({status:"thinking",message:"Analyzing your question..."})):(console.log("[Grounded Widget] Using REGULAR streaming mode"),h({status:"searching",message:"Searching knowledge base..."})),m.current=new AbortController;try{const R={message:q.trim()};x.current&&(R.conversationId=x.current);const B=r?`${e}/api/v1/widget/${t}/chat/agentic`:`${e}/api/v1/widget/${t}/chat/stream`;console.log("[Grounded Widget] Calling endpoint:",B);const L=await fetch(B,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(R),signal:m.current.signal});if(!L.ok){const W=await L.json().catch(()=>({}));throw new Error(W.message||`Request failed: ${L.status}`)}s(W=>[...W,{id:M,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),u(!1);const A=L.body?.getReader();if(!A)throw new Error("No response body");const et=new TextDecoder;let ge="",ee="",he=[],Y=[];for(;;){const{done:W,value:X}=await A.read();if(W)break;ge+=et.decode(X,{stream:!0});const Le=ge.split(`
`);ge=Le.pop()||"";for(const pe of Le)if(pe.startsWith("data: "))try{const y=JSON.parse(pe.slice(6));if(y.type==="status"){const te=y.status==="tool_call"?"tool_call":y.status==="thinking"?"thinking":y.status==="searching"?"searching":y.status==="generating"?"generating":"searching";h({status:te,message:y.message,sourcesCount:y.sourcesCount,toolName:y.toolName})}else if(y.type==="chain_of_thought"&&y.step)Y.push(y.step),_([...Y]);else if(y.type==="text"&&y.content)ee||h({status:"streaming"}),ee+=y.content,s(te=>te.map(re=>re.id===M?{...re,content:ee}:re));else if(y.type==="done"){if(y.conversationId){x.current=y.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,y.conversationId)}catch{}}he=y.citations||[],y.chainOfThought&&(Y=y.chainOfThought,_(Y)),h({status:"idle"})}else if(y.type==="error")throw new Error(y.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",pe)}}s(W=>W.map(X=>X.id===M?{...X,content:ee,isStreaming:!1,citations:he,chainOfThought:o?Y:void 0}:X))}catch(R){if(R.name==="AbortError"){h({status:"idle"});return}h({status:"idle"}),c(R instanceof Error?R.message:"An error occurred"),s(B=>B.some(A=>A.id===M)?B.map(A=>A.id===M?{...A,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:A):[...B,{id:M,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{u(!1),d(!1),m.current=null}},[t,e,a,i,r,o]),$=He(()=>{m.current&&(m.current.abort(),m.current=null),d(!1),u(!1)},[]),T=He(()=>{s([]),x.current=null;try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:n,isLoading:a,isStreaming:i,error:g,chatStatus:p,chainOfThoughtSteps:f,sendMessage:S,stopStreaming:$,clearMessages:T}}function pr({token:t,apiBase:e,enabled:r=!0}){const[o,n]=I(null),[s,a]=I(!0),[u,i]=I(null);return U(()=>{if(!r)return;async function d(){a(!0);try{const g=await fetch(`${e}/api/v1/widget/${t}/config`);if(!g.ok)throw new Error("Failed to load widget configuration");const c=await g.json();n(c)}catch(g){i(g instanceof Error?g.message:"Configuration error"),n({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0})}finally{a(!1)}}d()},[t,e,r]),{config:o,isLoading:s,error:u}}function We(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var Q=We();function At(t){Q=t}var ie={exec:()=>null};function k(t,e=""){let r=typeof t=="string"?t:t.source,o={replace:(n,s)=>{let a=typeof s=="string"?s:s.source;return a=a.replace(E.caret,"$1"),r=r.replace(n,a),o},getRegex:()=>new RegExp(r,e)};return o}var fr=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),E={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},mr=/^(?:[ \t]*(?:\n|$))+/,br=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,_r=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,le=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,xr=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,je=/(?:[*+-]|\d{1,9}[.)])/,It=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,Et=k(It).replace(/bull/g,je).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),kr=k(It).replace(/bull/g,je).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Ue=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,vr=/^[^\n]+/,De=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,wr=k(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",De).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),yr=k(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,je).getRegex(),ye="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Oe=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,Sr=k("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",Oe).replace("tag",ye).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),Mt=k(Ue).replace("hr",le).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ye).getRegex(),$r=k(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",Mt).getRegex(),Ge={blockquote:$r,code:br,def:wr,fences:_r,heading:xr,hr:le,html:Sr,lheading:Et,list:yr,newline:mr,paragraph:Mt,table:ie,text:vr},Bt=k("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",le).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ye).getRegex(),Cr={...Ge,lheading:kr,table:Bt,paragraph:k(Ue).replace("hr",le).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Bt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ye).getRegex()},zr={...Ge,html:k(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",Oe).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:ie,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:k(Ue).replace("hr",le).replace("heading",` *#{1,6} *[^
]`).replace("lheading",Et).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Tr=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,Lr=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,Nt=/^( {2,}|\\)\n(?!\s*$)/,Rr=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,Se=/[\p{P}\p{S}]/u,Qe=/[\s\p{P}\p{S}]/u,Pt=/[^\s\p{P}\p{S}]/u,Ar=k(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Qe).getRegex(),Ft=/(?!~)[\p{P}\p{S}]/u,Ir=/(?!~)[\s\p{P}\p{S}]/u,Er=/(?:[^\s\p{P}\p{S}]|~)/u,Mr=k(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",fr?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Ht=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,Br=k(Ht,"u").replace(/punct/g,Se).getRegex(),Nr=k(Ht,"u").replace(/punct/g,Ft).getRegex(),qt="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Pr=k(qt,"gu").replace(/notPunctSpace/g,Pt).replace(/punctSpace/g,Qe).replace(/punct/g,Se).getRegex(),Fr=k(qt,"gu").replace(/notPunctSpace/g,Er).replace(/punctSpace/g,Ir).replace(/punct/g,Ft).getRegex(),Hr=k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Pt).replace(/punctSpace/g,Qe).replace(/punct/g,Se).getRegex(),qr=k(/\\(punct)/,"gu").replace(/punct/g,Se).getRegex(),Wr=k(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),jr=k(Oe).replace("(?:-->|$)","-->").getRegex(),Ur=k("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",jr).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),$e=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,Dr=k(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",$e).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Wt=k(/^!?\[(label)\]\[(ref)\]/).replace("label",$e).replace("ref",De).getRegex(),jt=k(/^!?\[(ref)\](?:\[\])?/).replace("ref",De).getRegex(),Or=k("reflink|nolink(?!\\()","g").replace("reflink",Wt).replace("nolink",jt).getRegex(),Ut=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,Ze={_backpedal:ie,anyPunctuation:qr,autolink:Wr,blockSkip:Mr,br:Nt,code:Lr,del:ie,emStrongLDelim:Br,emStrongRDelimAst:Pr,emStrongRDelimUnd:Hr,escape:Tr,link:Dr,nolink:jt,punctuation:Ar,reflink:Wt,reflinkSearch:Or,tag:Ur,text:Rr,url:ie},Gr={...Ze,link:k(/^!?\[(label)\]\((.*?)\)/).replace("label",$e).getRegex(),reflink:k(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",$e).getRegex()},Ve={...Ze,emStrongRDelimAst:Fr,emStrongLDelim:Nr,url:k(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",Ut).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:k(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",Ut).getRegex()},Qr={...Ve,br:k(Nt).replace("{2,}","*").getRegex(),text:k(Ve.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},Ce={normal:Ge,gfm:Cr,pedantic:zr},de={normal:Ze,gfm:Ve,breaks:Qr,pedantic:Gr},Zr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Dt=t=>Zr[t];function D(t,e){if(e){if(E.escapeTest.test(t))return t.replace(E.escapeReplace,Dt)}else if(E.escapeTestNoEncode.test(t))return t.replace(E.escapeReplaceNoEncode,Dt);return t}function Ot(t){try{t=encodeURI(t).replace(E.percentDecode,"%")}catch{return null}return t}function Gt(t,e){let r=t.replace(E.findPipe,(s,a,u)=>{let i=!1,d=a;for(;--d>=0&&u[d]==="\\";)i=!i;return i?"|":" |"}),o=r.split(E.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(E.slashPipe,"|");return o}function ce(t,e,r){let o=t.length;if(o===0)return"";let n=0;for(;n<o&&t.charAt(o-n-1)===e;)n++;return t.slice(0,o-n)}function Vr(t,e){if(t.indexOf(e[1])===-1)return-1;let r=0;for(let o=0;o<t.length;o++)if(t[o]==="\\")o++;else if(t[o]===e[0])r++;else if(t[o]===e[1]&&(r--,r<0))return o;return r>0?-2:-1}function Qt(t,e,r,o,n){let s=e.href,a=e.title||null,u=t[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let i={type:t[0].charAt(0)==="!"?"image":"link",raw:r,href:s,title:a,text:u,tokens:o.inlineTokens(u)};return o.state.inLink=!1,i}function Yr(t,e,r){let o=t.match(r.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(s=>{let a=s.match(r.other.beginningSpace);if(a===null)return s;let[u]=a;return u.length>=n.length?s.slice(n.length):s}).join(`
`)}var ze=class{options;rules;lexer;constructor(t){this.options=t||Q}space(t){let e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){let e=this.rules.block.code.exec(t);if(e){let r=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?r:ce(r,`
`)}}}fences(t){let e=this.rules.block.fences.exec(t);if(e){let r=e[0],o=Yr(r,e[3]||"",this.rules);return{type:"code",raw:r,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(t){let e=this.rules.block.heading.exec(t);if(e){let r=e[2].trim();if(this.rules.other.endingHash.test(r)){let o=ce(r,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(r=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:r,tokens:this.lexer.inline(r)}}}hr(t){let e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:ce(e[0],`
`)}}blockquote(t){let e=this.rules.block.blockquote.exec(t);if(e){let r=ce(e[0],`
`).split(`
`),o="",n="",s=[];for(;r.length>0;){let a=!1,u=[],i;for(i=0;i<r.length;i++)if(this.rules.other.blockquoteStart.test(r[i]))u.push(r[i]),a=!0;else if(!a)u.push(r[i]);else break;r=r.slice(i);let d=u.join(`
`),g=d.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${d}`:d,n=n?`${n}
${g}`:g;let c=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(g,s,!0),this.lexer.state.top=c,r.length===0)break;let p=s.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){let h=p,f=h.raw+`
`+r.join(`
`),_=this.blockquote(f);s[s.length-1]=_,o=o.substring(0,o.length-h.raw.length)+_.raw,n=n.substring(0,n.length-h.text.length)+_.text;break}else if(p?.type==="list"){let h=p,f=h.raw+`
`+r.join(`
`),_=this.list(f);s[s.length-1]=_,o=o.substring(0,o.length-p.raw.length)+_.raw,n=n.substring(0,n.length-h.raw.length)+_.raw,r=f.substring(s.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:s,text:n}}}list(t){let e=this.rules.block.list.exec(t);if(e){let r=e[1].trim(),o=r.length>1,n={type:"list",raw:"",ordered:o,start:o?+r.slice(0,-1):"",loose:!1,items:[]};r=o?`\\d{1,9}\\${r.slice(-1)}`:`\\${r}`,this.options.pedantic&&(r=o?r:"[*+-]");let s=this.rules.other.listItemRegex(r),a=!1;for(;t;){let i=!1,d="",g="";if(!(e=s.exec(t))||this.rules.block.hr.test(t))break;d=e[0],t=t.substring(d.length);let c=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,_=>" ".repeat(3*_.length)),p=t.split(`
`,1)[0],h=!c.trim(),f=0;if(this.options.pedantic?(f=2,g=c.trimStart()):h?f=e[1].length+1:(f=e[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,g=c.slice(f),f+=e[1].length),h&&this.rules.other.blankLine.test(p)&&(d+=p+`
`,t=t.substring(p.length+1),i=!0),!i){let _=this.rules.other.nextBulletRegex(f),x=this.rules.other.hrRegex(f),m=this.rules.other.fencesBeginRegex(f),b=this.rules.other.headingBeginRegex(f),S=this.rules.other.htmlBeginRegex(f);for(;t;){let $=t.split(`
`,1)[0],T;if(p=$,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),T=p):T=p.replace(this.rules.other.tabCharGlobal,"    "),m.test(p)||b.test(p)||S.test(p)||_.test(p)||x.test(p))break;if(T.search(this.rules.other.nonSpaceChar)>=f||!p.trim())g+=`
`+T.slice(f);else{if(h||c.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||m.test(c)||b.test(c)||x.test(c))break;g+=`
`+p}!h&&!p.trim()&&(h=!0),d+=$+`
`,t=t.substring($.length+1),c=T.slice(f)}}n.loose||(a?n.loose=!0:this.rules.other.doubleBlankLine.test(d)&&(a=!0)),n.items.push({type:"list_item",raw:d,task:!!this.options.gfm&&this.rules.other.listIsTask.test(g),loose:!1,text:g,tokens:[]}),n.raw+=d}let u=n.items.at(-1);if(u)u.raw=u.raw.trimEnd(),u.text=u.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let i of n.items){if(this.lexer.state.top=!1,i.tokens=this.lexer.blockTokens(i.text,[]),i.task){if(i.text=i.text.replace(this.rules.other.listReplaceTask,""),i.tokens[0]?.type==="text"||i.tokens[0]?.type==="paragraph"){i.tokens[0].raw=i.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),i.tokens[0].text=i.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let g=this.lexer.inlineQueue.length-1;g>=0;g--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[g].src)){this.lexer.inlineQueue[g].src=this.lexer.inlineQueue[g].src.replace(this.rules.other.listReplaceTask,"");break}}let d=this.rules.other.listTaskCheckbox.exec(i.raw);if(d){let g={type:"checkbox",raw:d[0]+" ",checked:d[0]!=="[ ]"};i.checked=g.checked,n.loose?i.tokens[0]&&["paragraph","text"].includes(i.tokens[0].type)&&"tokens"in i.tokens[0]&&i.tokens[0].tokens?(i.tokens[0].raw=g.raw+i.tokens[0].raw,i.tokens[0].text=g.raw+i.tokens[0].text,i.tokens[0].tokens.unshift(g)):i.tokens.unshift({type:"paragraph",raw:g.raw,text:g.raw,tokens:[g]}):i.tokens.unshift(g)}}if(!n.loose){let d=i.tokens.filter(c=>c.type==="space"),g=d.length>0&&d.some(c=>this.rules.other.anyLine.test(c.raw));n.loose=g}}if(n.loose)for(let i of n.items){i.loose=!0;for(let d of i.tokens)d.type==="text"&&(d.type="paragraph")}return n}}html(t){let e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){let e=this.rules.block.def.exec(t);if(e){let r=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:r,raw:e[0],href:o,title:n}}}table(t){let e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let r=Gt(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],s={type:"table",raw:e[0],header:[],align:[],rows:[]};if(r.length===o.length){for(let a of o)this.rules.other.tableAlignRight.test(a)?s.align.push("right"):this.rules.other.tableAlignCenter.test(a)?s.align.push("center"):this.rules.other.tableAlignLeft.test(a)?s.align.push("left"):s.align.push(null);for(let a=0;a<r.length;a++)s.header.push({text:r[a],tokens:this.lexer.inline(r[a]),header:!0,align:s.align[a]});for(let a of n)s.rows.push(Gt(a,s.header.length).map((u,i)=>({text:u,tokens:this.lexer.inline(u),header:!1,align:s.align[i]})));return s}}lheading(t){let e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){let e=this.rules.block.paragraph.exec(t);if(e){let r=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:r,tokens:this.lexer.inline(r)}}}text(t){let e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){let e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){let e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){let e=this.rules.inline.link.exec(t);if(e){let r=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let s=ce(r.slice(0,-1),"\\");if((r.length-s.length)%2===0)return}else{let s=Vr(e[2],"()");if(s===-2)return;if(s>-1){let a=(e[0].indexOf("!")===0?5:4)+e[1].length+s;e[2]=e[2].substring(0,s),e[0]=e[0].substring(0,a).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let s=this.rules.other.pedanticHrefTitle.exec(o);s&&(o=s[1],n=s[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?o=o.slice(1):o=o.slice(1,-1)),Qt(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let r;if((r=this.rules.inline.reflink.exec(t))||(r=this.rules.inline.nolink.exec(t))){let o=(r[2]||r[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let s=r[0].charAt(0);return{type:"text",raw:s,text:s}}return Qt(r,n,r[0],this.lexer,this.rules)}}emStrong(t,e,r=""){let o=this.rules.inline.emStrongLDelim.exec(t);if(!(!o||o[3]&&r.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!r||this.rules.inline.punctuation.exec(r))){let n=[...o[0]].length-1,s,a,u=n,i=0,d=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(d.lastIndex=0,e=e.slice(-1*t.length+n);(o=d.exec(e))!=null;){if(s=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!s)continue;if(a=[...s].length,o[3]||o[4]){u+=a;continue}else if((o[5]||o[6])&&n%3&&!((n+a)%3)){i+=a;continue}if(u-=a,u>0)continue;a=Math.min(a,a+u+i);let g=[...o[0]][0].length,c=t.slice(0,n+o.index+g+a);if(Math.min(n,a)%2){let h=c.slice(1,-1);return{type:"em",raw:c,text:h,tokens:this.lexer.inlineTokens(h)}}let p=c.slice(2,-2);return{type:"strong",raw:c,text:p,tokens:this.lexer.inlineTokens(p)}}}}codespan(t){let e=this.rules.inline.code.exec(t);if(e){let r=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(r),n=this.rules.other.startingSpaceChar.test(r)&&this.rules.other.endingSpaceChar.test(r);return o&&n&&(r=r.substring(1,r.length-1)),{type:"codespan",raw:e[0],text:r}}}br(t){let e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){let e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){let e=this.rules.inline.autolink.exec(t);if(e){let r,o;return e[2]==="@"?(r=e[1],o="mailto:"+r):(r=e[1],o=r),{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}url(t){let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){let e=this.rules.inline.text.exec(t);if(e){let r=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:r}}}},F=class tt{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||Q,this.options.tokenizer=this.options.tokenizer||new ze,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let r={other:E,block:Ce.normal,inline:de.normal};this.options.pedantic?(r.block=Ce.pedantic,r.inline=de.pedantic):this.options.gfm&&(r.block=Ce.gfm,this.options.breaks?r.inline=de.breaks:r.inline=de.gfm),this.tokenizer.rules=r}static get rules(){return{block:Ce,inline:de}}static lex(e,r){return new tt(r).lex(e)}static lexInline(e,r){return new tt(r).inlineTokens(e)}lex(e){e=e.replace(E.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let r=0;r<this.inlineQueue.length;r++){let o=this.inlineQueue[r];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,r=[],o=!1){for(this.options.pedantic&&(e=e.replace(E.tabCharGlobal,"    ").replace(E.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(a=>(n=a.call({lexer:this},e,r))?(e=e.substring(n.raw.length),r.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let a=r.at(-1);n.raw.length===1&&a!==void 0?a.raw+=`
`:r.push(n);continue}if(n=this.tokenizer.code(e)){e=e.substring(n.raw.length);let a=r.at(-1);a?.type==="paragraph"||a?.type==="text"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.text,this.inlineQueue.at(-1).src=a.text):r.push(n);continue}if(n=this.tokenizer.fences(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.heading(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.hr(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.blockquote(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.list(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.html(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.def(e)){e=e.substring(n.raw.length);let a=r.at(-1);a?.type==="paragraph"||a?.type==="text"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.raw,this.inlineQueue.at(-1).src=a.text):this.tokens.links[n.tag]||(this.tokens.links[n.tag]={href:n.href,title:n.title},r.push(n));continue}if(n=this.tokenizer.table(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.lheading(e)){e=e.substring(n.raw.length),r.push(n);continue}let s=e;if(this.options.extensions?.startBlock){let a=1/0,u=e.slice(1),i;this.options.extensions.startBlock.forEach(d=>{i=d.call({lexer:this},u),typeof i=="number"&&i>=0&&(a=Math.min(a,i))}),a<1/0&&a>=0&&(s=e.substring(0,a+1))}if(this.state.top&&(n=this.tokenizer.paragraph(s))){let a=r.at(-1);o&&a?.type==="paragraph"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=a.text):r.push(n),o=s.length!==e.length,e=e.substring(n.raw.length);continue}if(n=this.tokenizer.text(e)){e=e.substring(n.raw.length);let a=r.at(-1);a?.type==="text"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=a.text):r.push(n);continue}if(e){let a="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(a);break}else throw new Error(a)}}return this.state.top=!0,r}inline(e,r=[]){return this.inlineQueue.push({src:e,tokens:r}),r}inlineTokens(e,r=[]){let o=e,n=null;if(this.tokens.links){let i=Object.keys(this.tokens.links);if(i.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)i.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let s;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)s=n[2]?n[2].length:0,o=o.slice(0,n.index+s)+"["+"a".repeat(n[0].length-s-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let a=!1,u="";for(;e;){a||(u=""),a=!1;let i;if(this.options.extensions?.inline?.some(g=>(i=g.call({lexer:this},e,r))?(e=e.substring(i.raw.length),r.push(i),!0):!1))continue;if(i=this.tokenizer.escape(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.tag(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.link(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(i.raw.length);let g=r.at(-1);i.type==="text"&&g?.type==="text"?(g.raw+=i.raw,g.text+=i.text):r.push(i);continue}if(i=this.tokenizer.emStrong(e,o,u)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.codespan(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.br(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.del(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.autolink(e)){e=e.substring(i.raw.length),r.push(i);continue}if(!this.state.inLink&&(i=this.tokenizer.url(e))){e=e.substring(i.raw.length),r.push(i);continue}let d=e;if(this.options.extensions?.startInline){let g=1/0,c=e.slice(1),p;this.options.extensions.startInline.forEach(h=>{p=h.call({lexer:this},c),typeof p=="number"&&p>=0&&(g=Math.min(g,p))}),g<1/0&&g>=0&&(d=e.substring(0,g+1))}if(i=this.tokenizer.inlineText(d)){e=e.substring(i.raw.length),i.raw.slice(-1)!=="_"&&(u=i.raw.slice(-1)),a=!0;let g=r.at(-1);g?.type==="text"?(g.raw+=i.raw,g.text+=i.text):r.push(i);continue}if(e){let g="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(g);break}else throw new Error(g)}}return r}},Te=class{options;parser;constructor(t){this.options=t||Q}space(t){return""}code({text:t,lang:e,escaped:r}){let o=(e||"").match(E.notSpaceStart)?.[0],n=t.replace(E.endingNewline,"")+`
`;return o?'<pre><code class="language-'+D(o)+'">'+(r?n:D(n,!0))+`</code></pre>
`:"<pre><code>"+(r?n:D(n,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}def(t){return""}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){let e=t.ordered,r=t.start,o="";for(let a=0;a<t.items.length;a++){let u=t.items[a];o+=this.listitem(u)}let n=e?"ol":"ul",s=e&&r!==1?' start="'+r+'"':"";return"<"+n+s+`>
`+o+"</"+n+`>
`}listitem(t){return`<li>${this.parser.parse(t.tokens)}</li>
`}checkbox({checked:t}){return"<input "+(t?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:t}){return`<p>${this.parser.parseInline(t)}</p>
`}table(t){let e="",r="";for(let n=0;n<t.header.length;n++)r+=this.tablecell(t.header[n]);e+=this.tablerow({text:r});let o="";for(let n=0;n<t.rows.length;n++){let s=t.rows[n];r="";for(let a=0;a<s.length;a++)r+=this.tablecell(s[a]);o+=this.tablerow({text:r})}return o&&(o=`<tbody>${o}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+o+`</table>
`}tablerow({text:t}){return`<tr>
${t}</tr>
`}tablecell(t){let e=this.parser.parseInline(t.tokens),r=t.header?"th":"td";return(t.align?`<${r} align="${t.align}">`:`<${r}>`)+e+`</${r}>
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${D(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:r}){let o=this.parser.parseInline(r),n=Ot(t);if(n===null)return o;t=n;let s='<a href="'+t+'"';return e&&(s+=' title="'+D(e)+'"'),s+=">"+o+"</a>",s}image({href:t,title:e,text:r,tokens:o}){o&&(r=this.parser.parseInline(o,this.parser.textRenderer));let n=Ot(t);if(n===null)return D(r);t=n;let s=`<img src="${t}" alt="${r}"`;return e&&(s+=` title="${D(e)}"`),s+=">",s}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:D(t.text)}},Ye=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}checkbox({raw:t}){return t}},H=class rt{options;renderer;textRenderer;constructor(e){this.options=e||Q,this.options.renderer=this.options.renderer||new Te,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Ye}static parse(e,r){return new rt(r).parse(e)}static parseInline(e,r){return new rt(r).parseInline(e)}parse(e){let r="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let a=n,u=this.options.extensions.renderers[a.type].call({parser:this},a);if(u!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(a.type)){r+=u||"";continue}}let s=n;switch(s.type){case"space":{r+=this.renderer.space(s);break}case"hr":{r+=this.renderer.hr(s);break}case"heading":{r+=this.renderer.heading(s);break}case"code":{r+=this.renderer.code(s);break}case"table":{r+=this.renderer.table(s);break}case"blockquote":{r+=this.renderer.blockquote(s);break}case"list":{r+=this.renderer.list(s);break}case"checkbox":{r+=this.renderer.checkbox(s);break}case"html":{r+=this.renderer.html(s);break}case"def":{r+=this.renderer.def(s);break}case"paragraph":{r+=this.renderer.paragraph(s);break}case"text":{r+=this.renderer.text(s);break}default:{let a='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return r}parseInline(e,r=this.renderer){let o="";for(let n=0;n<e.length;n++){let s=e[n];if(this.options.extensions?.renderers?.[s.type]){let u=this.options.extensions.renderers[s.type].call({parser:this},s);if(u!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(s.type)){o+=u||"";continue}}let a=s;switch(a.type){case"escape":{o+=r.text(a);break}case"html":{o+=r.html(a);break}case"link":{o+=r.link(a);break}case"image":{o+=r.image(a);break}case"checkbox":{o+=r.checkbox(a);break}case"strong":{o+=r.strong(a);break}case"em":{o+=r.em(a);break}case"codespan":{o+=r.codespan(a);break}case"br":{o+=r.br(a);break}case"del":{o+=r.del(a);break}case"text":{o+=r.text(a);break}default:{let u='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(u),"";throw new Error(u)}}}return o}},ue=class{options;block;constructor(t){this.options=t||Q}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}emStrongMask(t){return t}provideLexer(){return this.block?F.lex:F.lexInline}provideParser(){return this.block?H.parse:H.parseInline}},Xr=class{defaults=We();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=H;Renderer=Te;TextRenderer=Ye;Lexer=F;Tokenizer=ze;Hooks=ue;constructor(...t){this.use(...t)}walkTokens(t,e){let r=[];for(let o of t)switch(r=r.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let s of n.header)r=r.concat(this.walkTokens(s.tokens,e));for(let s of n.rows)for(let a of s)r=r.concat(this.walkTokens(a.tokens,e));break}case"list":{let n=o;r=r.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(s=>{let a=n[s].flat(1/0);r=r.concat(this.walkTokens(a,e))}):n.tokens&&(r=r.concat(this.walkTokens(n.tokens,e)))}}return r}use(...t){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(r=>{let o={...r};if(o.async=this.defaults.async||o.async||!1,r.extensions&&(r.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let s=e.renderers[n.name];s?e.renderers[n.name]=function(...a){let u=n.renderer.apply(this,a);return u===!1&&(u=s.apply(this,a)),u}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let s=e[n.level];s?s.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),r.renderer){let n=this.defaults.renderer||new Te(this.defaults);for(let s in r.renderer){if(!(s in n))throw new Error(`renderer '${s}' does not exist`);if(["options","parser"].includes(s))continue;let a=s,u=r.renderer[a],i=n[a];n[a]=(...d)=>{let g=u.apply(n,d);return g===!1&&(g=i.apply(n,d)),g||""}}o.renderer=n}if(r.tokenizer){let n=this.defaults.tokenizer||new ze(this.defaults);for(let s in r.tokenizer){if(!(s in n))throw new Error(`tokenizer '${s}' does not exist`);if(["options","rules","lexer"].includes(s))continue;let a=s,u=r.tokenizer[a],i=n[a];n[a]=(...d)=>{let g=u.apply(n,d);return g===!1&&(g=i.apply(n,d)),g}}o.tokenizer=n}if(r.hooks){let n=this.defaults.hooks||new ue;for(let s in r.hooks){if(!(s in n))throw new Error(`hook '${s}' does not exist`);if(["options","block"].includes(s))continue;let a=s,u=r.hooks[a],i=n[a];ue.passThroughHooks.has(s)?n[a]=d=>{if(this.defaults.async&&ue.passThroughHooksRespectAsync.has(s))return(async()=>{let c=await u.call(n,d);return i.call(n,c)})();let g=u.call(n,d);return i.call(n,g)}:n[a]=(...d)=>{if(this.defaults.async)return(async()=>{let c=await u.apply(n,d);return c===!1&&(c=await i.apply(n,d)),c})();let g=u.apply(n,d);return g===!1&&(g=i.apply(n,d)),g}}o.hooks=n}if(r.walkTokens){let n=this.defaults.walkTokens,s=r.walkTokens;o.walkTokens=function(a){let u=[];return u.push(s.call(this,a)),n&&(u=u.concat(n.call(this,a))),u}}this.defaults={...this.defaults,...o}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return F.lex(t,e??this.defaults)}parser(t,e){return H.parse(t,e??this.defaults)}parseMarkdown(t){return(e,r)=>{let o={...r},n={...this.defaults,...o},s=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return s(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return s(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return s(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=t),n.async)return(async()=>{let a=n.hooks?await n.hooks.preprocess(e):e,u=await(n.hooks?await n.hooks.provideLexer():t?F.lex:F.lexInline)(a,n),i=n.hooks?await n.hooks.processAllTokens(u):u;n.walkTokens&&await Promise.all(this.walkTokens(i,n.walkTokens));let d=await(n.hooks?await n.hooks.provideParser():t?H.parse:H.parseInline)(i,n);return n.hooks?await n.hooks.postprocess(d):d})().catch(s);try{n.hooks&&(e=n.hooks.preprocess(e));let a=(n.hooks?n.hooks.provideLexer():t?F.lex:F.lexInline)(e,n);n.hooks&&(a=n.hooks.processAllTokens(a)),n.walkTokens&&this.walkTokens(a,n.walkTokens);let u=(n.hooks?n.hooks.provideParser():t?H.parse:H.parseInline)(a,n);return n.hooks&&(u=n.hooks.postprocess(u)),u}catch(a){return s(a)}}}onError(t,e){return r=>{if(r.message+=`
Please report this to https://github.com/markedjs/marked.`,t){let o="<p>An error occurred:</p><pre>"+D(r.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(r);throw r}}},Z=new Xr;function v(t,e){return Z.parse(t,e)}v.options=v.setOptions=function(t){return Z.setOptions(t),v.defaults=Z.defaults,At(v.defaults),v},v.getDefaults=We,v.defaults=Q,v.use=function(...t){return Z.use(...t),v.defaults=Z.defaults,At(v.defaults),v},v.walkTokens=function(t,e){return Z.walkTokens(t,e)},v.parseInline=Z.parseInline,v.Parser=H,v.parser=H.parse,v.Renderer=Te,v.TextRenderer=Ye,v.Lexer=F,v.lexer=F.lex,v.Tokenizer=ze,v.Hooks=ue,v.parse=v,v.options,v.setOptions,v.use,v.walkTokens,v.parseInline,H.parse,F.lex;function Kr({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:l("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function Zt({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),l("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function Jr({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("path",{d:"m5 12 7-7 7 7"}),l("path",{d:"M12 19V5"})]})}function en({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:l("path",{d:"m6 9 6 6 6-6"})})}function Vt({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:l("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function Yt({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),l("path",{d:"M5 3v4"}),l("path",{d:"M19 17v4"}),l("path",{d:"M3 5h4"}),l("path",{d:"M17 19h4"})]})}function tn({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("polyline",{points:"15 3 21 3 21 9"}),l("polyline",{points:"9 21 3 21 3 15"}),l("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),l("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function rn({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("polyline",{points:"4 14 10 14 10 20"}),l("polyline",{points:"20 10 14 10 14 4"}),l("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),l("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function nn({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("circle",{cx:"12",cy:"12",r:"10"}),l("path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}),l("path",{d:"M12 17h.01"})]})}function on({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("path",{d:"M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1"}),l("circle",{cx:"12",cy:"19",r:"0.5",fill:"currentColor"})]})}function sn({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:l("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})})}function an({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),l("polyline",{points:"14 2 14 8 20 8"})]})}function ln({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("circle",{cx:"11",cy:"11",r:"8"}),l("path",{d:"m21 21-4.3-4.3"})]})}function dn({className:t}){return l("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("path",{d:"M15 3h6v6"}),l("path",{d:"M10 14 21 3"}),l("path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"})]})}v.setOptions({breaks:!0,gfm:!0});const Xt=new v.Renderer;Xt.link=({href:t,title:e,text:r})=>{const o=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${o}>${r}</a>`},v.use({renderer:Xt});function cn(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function un(t,e){if(!t)return"";let r=t;return r=r.replace(/【[^】]*】/g,""),r=r.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),r=r.replace(/\[Source:[^\]]*\]/gi,""),r=r.replace(/\(Source:[^)]*\)/gi,""),e&&e.length>0?r=r.replace(/\[(\d+)\]/g,(n,s)=>{const a=parseInt(s,10),u=e.find(i=>i.index===a);if(u){const i=(u.title||"").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),d=(u.url||"").replace(/"/g,"&quot;"),g=(u.snippet||"").replace(/"/g,"&quot;").replace(/'/g,"&#39;").slice(0,150),c=u.url?new URL(u.url).hostname:"";return`<span class="grounded-inline-citation" data-index="${a}" data-title="${i}" data-url="${d}" data-snippet="${g}" data-hostname="${c}">${c||"source"}</span>`}return n}):r=r.replace(/\[\d+\]/g,""),v.parse(r,{async:!1})}function gn({message:t}){const[e,r]=I(!1),[o,n]=I(null),s=G(null),a=t.role==="user",u=t.citations&&t.citations.length>0;return U(()=>{const i=s.current;if(!i)return;const d=p=>{const h=p.target;if(h.classList.contains("grounded-inline-citation")){const f=h.getBoundingClientRect(),_=i.getBoundingClientRect();n({index:parseInt(h.dataset.index||"0",10),title:h.dataset.title||"",url:h.dataset.url||"",snippet:h.dataset.snippet||"",hostname:h.dataset.hostname||"",x:f.left-_.left,y:f.bottom-_.top+4})}},g=p=>{p.target.classList.contains("grounded-inline-citation")&&n(null)},c=p=>{const h=p.target;h.classList.contains("grounded-inline-citation")&&h.dataset.url&&window.open(h.dataset.url,"_blank","noopener,noreferrer")};return i.addEventListener("mouseenter",d,!0),i.addEventListener("mouseleave",g,!0),i.addEventListener("click",c,!0),()=>{i.removeEventListener("mouseenter",d,!0),i.removeEventListener("mouseleave",g,!0),i.removeEventListener("click",c,!0)}},[]),l("div",{className:`grounded-message ${t.role}`,children:[l("div",{ref:s,className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:a?cn(t.content):un(t.content,t.citations)}}),t.isStreaming&&l("span",{className:"grounded-cursor"}),o&&l("div",{className:"grounded-citation-card",style:{left:`${o.x}px`,top:`${o.y}px`},onMouseEnter:()=>{},onMouseLeave:()=>n(null),children:[l("div",{className:"grounded-citation-card-header",children:l("span",{className:"grounded-citation-card-hostname",children:o.hostname})}),l("div",{className:"grounded-citation-card-body",children:[o.title&&l("div",{className:"grounded-citation-card-title",children:o.title}),o.url&&l("div",{className:"grounded-citation-card-url",children:o.url}),o.snippet&&l("div",{className:"grounded-citation-card-snippet",children:o.snippet}),o.url&&l("a",{href:o.url,target:"_blank",rel:"noopener noreferrer",className:"grounded-citation-card-link",children:[l(dn,{}),"Open source"]})]})]}),!a&&u&&l("div",{className:"grounded-sources",children:[l("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>r(!e),children:[l(Vt,{}),t.citations.length," source",t.citations.length!==1?"s":"",l(en,{})]}),l("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((i,d)=>{const g=i.url?.startsWith("upload://"),c=i.title||(g?"Uploaded Document":i.url)||`Source ${d+1}`;return g?l("div",{className:"grounded-source grounded-source-file",children:[l(an,{}),l("span",{className:"grounded-source-title",children:c})]},d):l("a",{href:i.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[l(Vt,{}),l("span",{className:"grounded-source-title",children:c})]},d)})})]})]})}function hn({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return l("div",{className:"grounded-status",children:l("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return l(ln,{className:"grounded-status-icon"});case"generating":return l(Yt,{className:"grounded-status-icon"});default:return null}})(),l("span",{className:"grounded-status-text",children:e()}),l("div",{className:"grounded-status-dots",children:[l("div",{className:"grounded-typing-dot"}),l("div",{className:"grounded-typing-dot"}),l("div",{className:"grounded-typing-dot"})]})]})})}const Xe=()=>l("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"}),l("path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"}),l("path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"}),l("path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375"}),l("path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5"}),l("path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396"}),l("path",{d:"M19.938 10.5a4 4 0 0 1 .585.396"}),l("path",{d:"M6 18a4 4 0 0 1-1.967-.516"}),l("path",{d:"M19.967 17.484A4 4 0 0 1 18 18"})]}),pn=()=>l("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("circle",{cx:"11",cy:"11",r:"8"}),l("path",{d:"m21 21-4.3-4.3"})]}),fn=()=>l("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:l("path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"})}),mn=()=>l("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[l("path",{d:"M22 11.08V12a10 10 0 1 1-5.93-9.14"}),l("path",{d:"m9 11 3 3L22 4"})]}),bn=()=>l("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:l("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})}),_n=({expanded:t})=>l("svg",{width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",style:{transform:t?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"},children:l("path",{d:"m6 9 6 6 6-6"})}),Ke=()=>l("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",class:"grounded-agentic-spinner",children:l("path",{d:"M21 12a9 9 0 1 1-6.219-8.56"})});function Kt({steps:t,status:e,isStreaming:r}){const[o,n]=I(!0),s=G(!1);if(U(()=>{if(s.current&&!r){const d=setTimeout(()=>{n(!1)},500);return()=>clearTimeout(d)}s.current=r},[r]),U(()=>{r&&t.length>0&&n(!0)},[r,t.length]),t.length===0&&e.status==="idle")return null;const a=(d,g)=>{if(g)return l(Ke,{});switch(d){case"thinking":return l(Xe,{});case"searching":return l(pn,{});case"tool_call":return l(fn,{});case"tool_result":return l(mn,{});case"answering":return l(bn,{});default:return l(Xe,{})}},u=d=>{switch(d.type){case"thinking":return"Analyzing...";case"searching":return d.kbName?`Searching "${d.kbName}"`:"Searching";case"tool_call":return d.toolName?`Using ${d.toolName}`:"Using tool";case"tool_result":return d.toolName?`${d.toolName} done`:"Completed";case"answering":return"Responding";default:return"Processing"}},i=()=>{if(r&&e.status!=="idle"&&e.status!=="streaming")switch(e.status){case"thinking":return"Thinking...";case"searching":return e.message||"Searching...";case"tool_call":return e.toolName?`Using ${e.toolName}...`:"Using tool...";case"generating":return"Generating...";default:return"Processing..."}const d=t.filter(c=>c.type==="tool_call").length,g=t.filter(c=>c.type==="searching").length;if(d>0||g>0){const c=[];return g>0&&c.push(`${g} search${g>1?"es":""}`),d>0&&c.push(`${d} tool${d>1?"s":""}`),`Used ${c.join(" and ")}`}return"Chain of thought"};return l("div",{class:"grounded-agentic-steps",children:[l("button",{class:"grounded-agentic-header",onClick:()=>n(!o),type:"button",children:[l("span",{class:"grounded-agentic-header-icon",children:r&&e.status!=="idle"&&e.status!=="streaming"?l(Ke,{}):l(Xe,{})}),l("span",{class:"grounded-agentic-header-text",children:i()}),l("span",{class:"grounded-agentic-header-chevron",children:l(_n,{expanded:o})})]}),o&&t.length>0&&l("div",{class:"grounded-agentic-content",children:t.map((d,g)=>{const c=g===t.length-1,p=c&&r&&e.status!=="streaming";return l("div",{class:"grounded-agentic-step",children:[l("div",{class:"grounded-agentic-step-icon",children:a(d.type,p)}),l("div",{class:"grounded-agentic-step-content",children:l("span",{class:`grounded-agentic-step-label ${p?"active":""}`,children:u(d)})}),!c&&l("div",{class:"grounded-agentic-step-line"})]},`${d.type}-${d.timestamp}`)})})]})}function xn({status:t}){return t.status==="idle"||t.status==="streaming"?null:l("div",{class:"grounded-agentic-status",children:[l("span",{class:"grounded-agentic-status-icon",children:l(Ke,{})}),l("span",{class:"grounded-agentic-status-text",children:(()=>{switch(t.status){case"thinking":return t.message||"Thinking...";case"searching":return t.message||"Searching...";case"tool_call":return t.toolName?`Using ${t.toolName}...`:"Using tool...";case"generating":return t.message||"Generating...";default:return"Processing..."}})()})]})}function Jt({options:t,initialOpen:e=!1,onOpenChange:r}){const{token:o,apiBase:n="",position:s="bottom-right"}=t,[a,u]=I(e),[i,d]=I(!1),[g,c]=I(""),p=G(null),h=G(null),{config:f,isLoading:_}=pr({token:o,apiBase:n,enabled:a}),x=f?.agenticMode?.enabled??!1,m=f?.agenticMode?.showChainOfThought??!1;U(()=>{a&&f&&console.log("[Grounded Widget] Config loaded:",{agenticMode:x,showChainOfThought:m,rawAgenticMode:f?.agenticMode})},[a,f,x,m]);const{messages:b,isLoading:S,chatStatus:$,chainOfThoughtSteps:T,sendMessage:q}=hr({token:o,apiBase:n,agenticMode:x,showChainOfThought:m});U(()=>{p.current&&p.current.scrollIntoView({behavior:"smooth"})},[b,S]),U(()=>{a&&h.current&&setTimeout(()=>h.current?.focus(),100)},[a]);const V=G(!1);U(()=>{V.current&&!S&&a&&setTimeout(()=>h.current?.focus(),50),V.current=S},[S,a]),U(()=>{r?.(a)},[a,r]);const M=()=>{u(!a)},R=()=>{g.trim()&&!S&&(q(g),c(""),h.current&&(h.current.style.height="auto"),setTimeout(()=>{h.current?.focus()},50))},B=N=>{N.key==="Enter"&&!N.shiftKey&&(N.preventDefault(),R())},L=N=>{const ne=N.target;c(ne.value),ne.style.height="auto",ne.style.height=Math.min(ne.scrollHeight,120)+"px"},A=s==="bottom-left",et=f?.agentName||"Assistant",ge=f?.welcomeMessage||"How can I help?",ee=f?.description||"Ask me anything. I'm here to assist you.",he=f?.logoUrl,Y=b.length===0&&!S,W=f?.theme?.buttonStyle||"circle",X=f?.theme?.buttonSize||"medium",Le=f?.theme?.buttonText||"Chat with us",pe=f?.theme?.buttonIcon||"chat",y=f?.theme?.buttonColor||"#2563eb",te=f?.theme?.customIconUrl,re=f?.theme?.customIconSize,wn=()=>{if(te){const N=re?{"--custom-icon-size":`${re}px`}:void 0;return l("img",{src:te,alt:"",className:"grounded-launcher-custom-icon",style:N})}switch(pe){case"help":return l(nn,{});case"question":return l(on,{});case"message":return l(sn,{});default:return l(Kr,{})}};return l("div",{className:`grounded-container ${A?"left":""}`,children:[l("div",{className:`grounded-window ${a?"open":""} ${i?"expanded":""}`,children:[l("div",{className:"grounded-header",children:[l("div",{className:"grounded-header-left",children:[he&&l("img",{src:he,alt:"",className:"grounded-header-logo"}),l("h2",{className:"grounded-header-title",children:et})]}),l("div",{className:"grounded-header-actions",children:[l("button",{className:"grounded-header-btn",onClick:()=>d(!i),"aria-label":i?"Shrink chat":"Expand chat",children:i?l(rn,{}):l(tn,{})}),l("button",{className:"grounded-header-btn",onClick:M,"aria-label":"Close chat",children:l(Zt,{})})]})]}),l("div",{className:"grounded-messages",children:[Y?l("div",{className:"grounded-empty",children:[l(Yt,{className:"grounded-empty-icon"}),l("h3",{className:"grounded-empty-title",children:ee}),l("p",{className:"grounded-empty-text",children:ge})]}):l(K,{children:[(()=>{const N=b.filter(P=>P.content||P.role==="user"),ne=x&&m&&T.length>0;let tr=-1,rr=!1;for(let P=0;P<N.length;P++)N[P].role==="user"?rr=!0:N[P].role==="assistant"&&rr&&(tr=P);return N.map((P,yn)=>{const Sn=ne&&yn===tr&&P.role==="assistant";return l("div",{children:[Sn&&l(Kt,{steps:T,status:$,isStreaming:S||$.status!=="idle"&&$.status!=="streaming"}),l(gn,{message:P})]},P.id)})})(),x&&m&&T.length>0&&(S||$.status!=="idle")&&b[b.length-1]?.role!=="assistant"&&l(Kt,{steps:T,status:$,isStreaming:!0}),(S||$.status!=="idle")&&$.status!=="streaming"&&!(x&&m&&T.length>0)&&(x?l(xn,{status:$}):l(hn,{status:$}))]}),l("div",{ref:p})]}),l("div",{className:"grounded-input-area",children:l("div",{className:"grounded-input-container",children:[l("textarea",{ref:h,className:"grounded-input",placeholder:_?"Loading...":"Type a message...",value:g,onInput:L,onKeyDown:B,rows:1,disabled:S||_}),l("button",{className:"grounded-send",onClick:R,disabled:!g.trim()||S||_,"aria-label":"Send message",children:l(Jr,{})})]})}),l("div",{className:"grounded-footer",children:["Powered by ",l("a",{href:"https://grounded.ai",target:"_blank",rel:"noopener",children:"Grounded"})]})]}),l("button",{className:`grounded-launcher grounded-launcher--${W} grounded-launcher--${X} ${a?"open":""}`,onClick:M,"aria-label":a?"Close chat":"Open chat",style:{backgroundColor:y},children:a?l(Zt,{}):l(K,{children:[wn(),W==="pill"&&l("span",{className:"grounded-launcher-text",children:Le})]})})]})}const kn=`
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans:wght@400;500;600&display=swap');

  :host {
    /* Color System - Light Theme (default) */
    --grounded-bg-primary: #F8FAFC;
    --grounded-bg-secondary: #F1F5F9;
    --grounded-bg-tertiary: #E2E8F0;
    --grounded-bg-elevated: #FFFFFF;

    --grounded-text-primary: #0F172A;
    --grounded-text-secondary: #475569;
    --grounded-text-tertiary: #94A3B8;
    --grounded-text-inverse: #FFFFFF;

    /* Blue Accent */
    --grounded-accent: #3B82F6;
    --grounded-accent-hover: #2563EB;
    --grounded-accent-subtle: #EFF6FF;

    /* Borders & Shadows */
    --grounded-border: #E2E8F0;
    --grounded-border-subtle: #F1F5F9;
    --grounded-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
    --grounded-shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
    --grounded-shadow-lg: 0 12px 40px rgba(15, 23, 42, 0.12);
    --grounded-shadow-xl: 0 20px 60px rgba(15, 23, 42, 0.16);

    /* Code block colors */
    --grounded-code-bg: #1E293B;
    --grounded-code-text: #E2E8F0;

    /* Typography */
    --grounded-font-sans: 'Noto Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    --grounded-font-mono: 'IBM Plex Mono', 'SF Mono', Monaco, monospace;

    /* Spacing */
    --grounded-space-xs: 4px;
    --grounded-space-sm: 8px;
    --grounded-space-md: 16px;
    --grounded-space-lg: 24px;
    --grounded-space-xl: 32px;

    /* Radii */
    --grounded-radius-sm: 8px;
    --grounded-radius-md: 12px;
    --grounded-radius-lg: 20px;
    --grounded-radius-full: 9999px;

    /* Animation */
    --grounded-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --grounded-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
    --grounded-duration-fast: 150ms;
    --grounded-duration-normal: 250ms;
    --grounded-duration-slow: 400ms;

    all: initial;
    font-family: var(--grounded-font-sans);
    font-size: 15px;
    line-height: 1.5;
    color: var(--grounded-text-primary);
    color-scheme: light;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Dark Theme - Applied via :host(.dark) class */
  :host(.dark) {
    --grounded-bg-primary: #0F172A;
    --grounded-bg-secondary: #1E293B;
    --grounded-bg-tertiary: #334155;
    --grounded-bg-elevated: #1E293B;

    --grounded-text-primary: #F1F5F9;
    --grounded-text-secondary: #94A3B8;
    --grounded-text-tertiary: #64748B;
    --grounded-text-inverse: #0F172A;

    /* Blue Accent - brighter for dark */
    --grounded-accent: #60A5FA;
    --grounded-accent-hover: #3B82F6;
    --grounded-accent-subtle: rgba(96, 165, 250, 0.15);

    /* Borders & Shadows */
    --grounded-border: #334155;
    --grounded-border-subtle: #1E293B;
    --grounded-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
    --grounded-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
    --grounded-shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.4);
    --grounded-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.5);

    /* Code block colors - slightly lighter in dark mode for contrast */
    --grounded-code-bg: #0F172A;
    --grounded-code-text: #E2E8F0;

    color-scheme: dark;
  }

  /* Auto dark mode via system preference */
  @media (prefers-color-scheme: dark) {
    :host(:not(.light)) {
      --grounded-bg-primary: #0F172A;
      --grounded-bg-secondary: #1E293B;
      --grounded-bg-tertiary: #334155;
      --grounded-bg-elevated: #1E293B;

      --grounded-text-primary: #F1F5F9;
      --grounded-text-secondary: #94A3B8;
      --grounded-text-tertiary: #64748B;
      --grounded-text-inverse: #0F172A;

      --grounded-accent: #60A5FA;
      --grounded-accent-hover: #3B82F6;
      --grounded-accent-subtle: rgba(96, 165, 250, 0.15);

      --grounded-border: #334155;
      --grounded-border-subtle: #1E293B;
      --grounded-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
      --grounded-shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
      --grounded-shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.4);
      --grounded-shadow-xl: 0 20px 60px rgba(0, 0, 0, 0.5);

      --grounded-code-bg: #0F172A;
      --grounded-code-text: #E2E8F0;

      color-scheme: dark;
    }
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* Container */
  .grounded-container {
    position: fixed;
    bottom: var(--grounded-space-lg);
    right: var(--grounded-space-lg);
    z-index: 2147483647;
    font-family: var(--grounded-font-sans);
  }

  .grounded-container.left {
    right: auto;
    left: var(--grounded-space-lg);
  }

  /* Launcher Button - Base Styles */
  .grounded-launcher {
    border: none;
    background: var(--grounded-accent);
    color: var(--grounded-text-inverse);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--grounded-space-sm);
    box-shadow: var(--grounded-shadow-lg);
    transition:
      transform var(--grounded-duration-normal) var(--grounded-ease-out),
      box-shadow var(--grounded-duration-normal) var(--grounded-ease-out),
      background var(--grounded-duration-fast);
    position: relative;
    overflow: hidden;
    font-family: var(--grounded-font-sans);
    font-weight: 500;
  }

  .grounded-launcher::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%);
    opacity: 0;
    transition: opacity var(--grounded-duration-fast);
  }

  .grounded-launcher:hover {
    transform: scale(1.05);
    box-shadow: var(--grounded-shadow-xl);
    background: var(--grounded-accent-hover);
  }

  .grounded-launcher:hover::before {
    opacity: 1;
  }

  .grounded-launcher:active {
    transform: scale(0.98);
  }

  .grounded-launcher svg {
    transition: transform var(--grounded-duration-normal) var(--grounded-ease-out);
    flex-shrink: 0;
  }

  .grounded-launcher.open {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.8);
  }

  .grounded-launcher.open svg {
    transform: rotate(90deg) scale(0.9);
  }

  /* Button text for pill style */
  .grounded-launcher-text {
    white-space: nowrap;
  }

  /* Custom icon image - uses CSS custom properties for size override */
  .grounded-launcher-custom-icon {
    width: var(--custom-icon-size, 24px);
    height: var(--custom-icon-size, 24px);
    object-fit: contain;
    flex-shrink: 0;
    transition: transform var(--grounded-duration-normal) var(--grounded-ease-out);
  }

  .grounded-launcher--small .grounded-launcher-custom-icon {
    width: var(--custom-icon-size, 20px);
    height: var(--custom-icon-size, 20px);
  }

  .grounded-launcher--large .grounded-launcher-custom-icon {
    width: var(--custom-icon-size, 28px);
    height: var(--custom-icon-size, 28px);
  }

  /* Button Style: Circle (default) */
  .grounded-launcher--circle {
    border-radius: var(--grounded-radius-full);
  }

  /* Button Style: Pill */
  .grounded-launcher--pill {
    border-radius: var(--grounded-radius-full);
    padding-left: var(--grounded-space-md);
    padding-right: var(--grounded-space-lg);
  }

  /* Button Style: Square */
  .grounded-launcher--square {
    border-radius: var(--grounded-radius-md);
  }

  /* Button Size: Small */
  .grounded-launcher--small {
    height: 44px;
    font-size: 13px;
  }
  .grounded-launcher--small.grounded-launcher--circle,
  .grounded-launcher--small.grounded-launcher--square {
    width: 44px;
  }
  .grounded-launcher--small svg {
    width: 20px;
    height: 20px;
  }

  /* Button Size: Medium (default) */
  .grounded-launcher--medium {
    height: 56px;
    font-size: 15px;
  }
  .grounded-launcher--medium.grounded-launcher--circle,
  .grounded-launcher--medium.grounded-launcher--square {
    width: 56px;
  }
  .grounded-launcher--medium svg {
    width: 24px;
    height: 24px;
  }

  /* Button Size: Large */
  .grounded-launcher--large {
    height: 64px;
    font-size: 16px;
  }
  .grounded-launcher--large.grounded-launcher--circle,
  .grounded-launcher--large.grounded-launcher--square {
    width: 64px;
  }
  .grounded-launcher--large svg {
    width: 28px;
    height: 28px;
  }

  /* Pill adjustments for sizes */
  .grounded-launcher--pill.grounded-launcher--small {
    padding-left: 12px;
    padding-right: 16px;
  }
  .grounded-launcher--pill.grounded-launcher--medium {
    padding-left: 16px;
    padding-right: 20px;
  }
  .grounded-launcher--pill.grounded-launcher--large {
    padding-left: 20px;
    padding-right: 24px;
  }

  /* Chat Window */
  .grounded-window {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 400px;
    height: min(600px, calc(100vh - 48px));
    background: var(--grounded-bg-primary);
    border-radius: var(--grounded-radius-lg);
    box-shadow: var(--grounded-shadow-xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    transform: translateY(16px) scale(0.96);
    transform-origin: bottom right;
    pointer-events: none;
    transition:
      opacity var(--grounded-duration-slow) var(--grounded-ease-out),
      transform var(--grounded-duration-slow) var(--grounded-ease-out);
  }

  .grounded-container.left .grounded-window {
    right: auto;
    left: 0;
    transform-origin: bottom left;
  }

  .grounded-window.open {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .grounded-window.expanded {
    width: 650px;
    height: min(900px, calc(100vh - 60px));
  }

  /* Header */
  .grounded-header {
    padding: var(--grounded-space-md) var(--grounded-space-lg);
    background: var(--grounded-bg-elevated);
    border-bottom: 1px solid var(--grounded-border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    z-index: 1;
  }

  .grounded-header-left {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-sm);
  }

  .grounded-header-logo {
    width: 32px;
    height: 32px;
    border-radius: var(--grounded-radius-sm);
    object-fit: cover;
  }

  .grounded-header-title {
    font-family: var(--grounded-font-sans);
    font-size: 17px;
    font-weight: 600;
    color: var(--grounded-text-primary);
    letter-spacing: -0.01em;
  }

  .grounded-header-actions {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-xs);
  }

  .grounded-header-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--grounded-radius-sm);
    border: none;
    background: transparent;
    color: var(--grounded-text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background var(--grounded-duration-fast),
      color var(--grounded-duration-fast);
  }

  .grounded-header-btn:hover {
    background: var(--grounded-bg-secondary);
    color: var(--grounded-text-primary);
  }

  .grounded-header-btn svg {
    width: 18px;
    height: 18px;
  }

  /* Messages Area */
  .grounded-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--grounded-space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--grounded-space-md);
    position: relative;
    z-index: 1;
    scroll-behavior: smooth;
  }

  .grounded-messages::-webkit-scrollbar {
    width: 6px;
  }

  .grounded-messages::-webkit-scrollbar-track {
    background: transparent;
  }

  .grounded-messages::-webkit-scrollbar-thumb {
    background: var(--grounded-border);
    border-radius: var(--grounded-radius-full);
  }

  /* Empty State */
  .grounded-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--grounded-space-xl);
    color: var(--grounded-text-secondary);
  }

  .grounded-empty-icon {
    width: 48px;
    height: 48px;
    margin-bottom: var(--grounded-space-md);
    color: var(--grounded-accent);
    opacity: 0.6;
  }

  .grounded-empty-title {
    font-family: var(--grounded-font-sans);
    font-size: 17px;
    font-weight: 600;
    color: var(--grounded-text-primary);
    margin-bottom: var(--grounded-space-xs);
  }

  .grounded-empty-text {
    font-size: 14px;
    color: var(--grounded-text-tertiary);
    max-width: 260px;
  }

  /* Message Bubble */
  .grounded-message {
    max-width: 85%;
    animation: grounded-message-in var(--grounded-duration-slow) var(--grounded-ease-out) forwards;
    opacity: 0;
    transform: translateY(8px);
  }

  @keyframes grounded-message-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .grounded-message.user {
    align-self: flex-end;
  }

  .grounded-message.assistant {
    align-self: flex-start;
  }

  .grounded-message-bubble {
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    border-radius: var(--grounded-radius-md);
    font-size: 15px;
    line-height: 1.55;
    overflow-x: auto;
    max-width: 100%;
  }

  .grounded-message.user .grounded-message-bubble {
    background: var(--grounded-accent);
    color: var(--grounded-text-inverse);
    border-bottom-right-radius: var(--grounded-space-xs);
  }

  .grounded-message.assistant .grounded-message-bubble {
    background: var(--grounded-bg-elevated);
    color: var(--grounded-text-primary);
    border: 1px solid var(--grounded-border);
    border-bottom-left-radius: var(--grounded-space-xs);
  }

  /* Message Content Formatting */
  .grounded-message-bubble p {
    margin: 0 0 var(--grounded-space-sm) 0;
  }

  .grounded-message-bubble p:last-child {
    margin-bottom: 0;
  }

  .grounded-message-bubble strong {
    font-weight: 600;
  }

  .grounded-message-bubble em {
    font-style: italic;
  }

  .grounded-message-bubble code {
    font-family: var(--grounded-font-mono);
    font-size: 13px;
    background: var(--grounded-bg-tertiary);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .grounded-message.user .grounded-message-bubble code {
    background: rgba(255,255,255,0.2);
  }

  .grounded-message-bubble pre {
    background: var(--grounded-code-bg);
    color: var(--grounded-code-text);
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    border-radius: var(--grounded-radius-sm);
    overflow-x: auto;
    margin: var(--grounded-space-sm) 0;
    font-family: var(--grounded-font-mono);
    font-size: 13px;
    line-height: 1.5;
  }

  .grounded-message-bubble pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    color: inherit;
    font-family: inherit;
  }

  .grounded-message-bubble a {
    color: var(--grounded-accent);
    text-decoration: none;
    border-bottom: 1px solid currentColor;
    transition: opacity var(--grounded-duration-fast);
  }

  .grounded-message-bubble a:hover {
    opacity: 0.7;
  }

  /* Lists */
  .grounded-message-bubble ol,
  .grounded-message-bubble ul {
    margin: var(--grounded-space-sm) 0;
    padding-left: var(--grounded-space-lg);
  }

  .grounded-message-bubble ol {
    list-style-type: decimal;
  }

  .grounded-message-bubble ul {
    list-style-type: disc;
  }

  .grounded-message-bubble li {
    margin-bottom: var(--grounded-space-xs);
    line-height: 1.5;
  }

  .grounded-message-bubble li:last-child {
    margin-bottom: 0;
  }

  /* Headings */
  .grounded-message-bubble h1,
  .grounded-message-bubble h2,
  .grounded-message-bubble h3,
  .grounded-message-bubble h4,
  .grounded-message-bubble h5,
  .grounded-message-bubble h6 {
    font-family: var(--grounded-font-sans);
    font-weight: 600;
    line-height: 1.3;
    margin: var(--grounded-space-md) 0 var(--grounded-space-sm) 0;
    color: var(--grounded-text-primary);
  }

  .grounded-message-bubble h1:first-child,
  .grounded-message-bubble h2:first-child,
  .grounded-message-bubble h3:first-child {
    margin-top: 0;
  }

  .grounded-message-bubble h1 { font-size: 1.5em; }
  .grounded-message-bubble h2 { font-size: 1.3em; }
  .grounded-message-bubble h3 { font-size: 1.15em; }
  .grounded-message-bubble h4 { font-size: 1.05em; }
  .grounded-message-bubble h5 { font-size: 1em; }
  .grounded-message-bubble h6 { font-size: 0.95em; color: var(--grounded-text-secondary); }

  /* Blockquotes */
  .grounded-message-bubble blockquote {
    margin: var(--grounded-space-sm) 0;
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    border-left: 3px solid var(--grounded-accent);
    background: var(--grounded-bg-secondary);
    border-radius: 0 var(--grounded-radius-sm) var(--grounded-radius-sm) 0;
    color: var(--grounded-text-secondary);
    font-style: italic;
  }

  .grounded-message-bubble blockquote p {
    margin: 0;
  }

  /* Horizontal Rule */
  .grounded-message-bubble hr {
    border: none;
    border-top: 1px solid var(--grounded-border);
    margin: var(--grounded-space-md) 0;
  }

  /* Tables */
  .grounded-message-bubble table {
    width: 100%;
    max-width: 100%;
    border-collapse: collapse;
    margin: var(--grounded-space-sm) 0;
    font-size: 13px;
    display: block;
    overflow-x: auto;
  }

  .grounded-message-bubble th,
  .grounded-message-bubble td {
    padding: var(--grounded-space-xs) var(--grounded-space-sm);
    text-align: left;
    border: 1px solid var(--grounded-border);
  }

  .grounded-message-bubble th {
    background: var(--grounded-bg-secondary);
    font-weight: 600;
    color: var(--grounded-text-primary);
  }

  .grounded-message-bubble td {
    background: var(--grounded-bg-elevated);
  }

  .grounded-message-bubble tr:nth-child(even) td {
    background: var(--grounded-bg-primary);
  }

  /* Streaming Cursor */
  .grounded-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--grounded-accent);
    margin-left: 2px;
    animation: grounded-blink 1s ease-in-out infinite;
    vertical-align: text-bottom;
  }

  @keyframes grounded-blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  /* Sources */
  .grounded-sources {
    margin-top: var(--grounded-space-sm);
  }

  .grounded-sources-trigger {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-xs);
    padding: var(--grounded-space-xs) var(--grounded-space-sm);
    background: var(--grounded-accent-subtle);
    border: none;
    border-radius: var(--grounded-radius-sm);
    font-family: var(--grounded-font-sans);
    font-size: 12px;
    font-weight: 500;
    color: var(--grounded-accent);
    cursor: pointer;
    transition: background var(--grounded-duration-fast), color var(--grounded-duration-fast);
  }

  .grounded-sources-trigger:hover {
    background: var(--grounded-accent);
    color: var(--grounded-text-inverse);
  }

  .grounded-sources-trigger svg {
    width: 12px;
    height: 12px;
    transition: transform var(--grounded-duration-fast);
  }

  .grounded-sources-trigger.open svg {
    transform: rotate(180deg);
  }

  .grounded-sources-list {
    display: none;
    margin-top: var(--grounded-space-sm);
    padding: var(--grounded-space-sm);
    background: var(--grounded-bg-secondary);
    border-radius: var(--grounded-radius-sm);
  }

  .grounded-sources-list.open {
    display: block;
    animation: grounded-fade-in var(--grounded-duration-fast) var(--grounded-ease-out);
  }

  @keyframes grounded-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .grounded-source {
    display: flex;
    align-items: flex-start;
    gap: var(--grounded-space-sm);
    padding: var(--grounded-space-xs) 0;
    text-decoration: none;
    color: var(--grounded-text-secondary);
    font-size: 13px;
    transition: color var(--grounded-duration-fast);
  }

  .grounded-source:hover {
    color: var(--grounded-accent);
  }

  .grounded-source-file {
    cursor: default;
  }

  .grounded-source-file:hover {
    color: var(--grounded-text-secondary);
  }

  .grounded-source svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .grounded-source-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Typing Indicator - Centered in message area */
  .grounded-typing {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: var(--grounded-space-lg);
    flex: 1;
    min-height: 100px;
  }

  .grounded-typing-dot {
    width: 8px;
    height: 8px;
    background: var(--grounded-accent);
    border-radius: 50%;
    animation: grounded-typing 1.4s ease-in-out infinite;
  }

  .grounded-typing-dot:nth-child(1) { animation-delay: 0s; }
  .grounded-typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .grounded-typing-dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes grounded-typing {
    0%, 60%, 100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    30% {
      transform: translateY(-6px);
      opacity: 1;
    }
  }

  /* Input Area */
  .grounded-input-area {
    padding: var(--grounded-space-md) var(--grounded-space-lg);
    background: var(--grounded-bg-elevated);
    border-top: 1px solid var(--grounded-border-subtle);
    position: relative;
    z-index: 1;
  }

  .grounded-input-container {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-sm);
    background: var(--grounded-bg-secondary);
    border: 1px solid var(--grounded-border);
    border-radius: var(--grounded-radius-md);
    padding: var(--grounded-space-sm);
    transition: box-shadow var(--grounded-duration-fast), border-color var(--grounded-duration-fast);
  }

  .grounded-input-container:focus-within {
    border-color: var(--grounded-accent);
    box-shadow: 0 0 0 2px var(--grounded-accent-subtle);
  }

  .grounded-input {
    flex: 1;
    border: none;
    background: transparent;
    font-family: var(--grounded-font-sans);
    font-size: 15px;
    line-height: 1.4;
    color: var(--grounded-text-primary);
    resize: none;
    outline: none;
    min-height: 36px;
    max-height: 120px;
    padding: 8px 4px;
    display: flex;
    align-items: center;
  }

  .grounded-input::placeholder {
    color: var(--grounded-text-tertiary);
  }

  .grounded-send {
    width: 36px;
    height: 36px;
    border-radius: var(--grounded-radius-sm);
    border: none;
    background: var(--grounded-accent);
    color: var(--grounded-text-inverse);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background var(--grounded-duration-fast),
      transform var(--grounded-duration-fast);
  }

  .grounded-send:hover:not(:disabled) {
    background: var(--grounded-accent-hover);
  }

  .grounded-send:active:not(:disabled) {
    transform: scale(0.95);
  }

  .grounded-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .grounded-send svg {
    width: 18px;
    height: 18px;
  }

  /* Footer */
  .grounded-footer {
    padding: var(--grounded-space-sm) var(--grounded-space-lg);
    text-align: center;
    font-size: 11px;
    color: var(--grounded-text-tertiary);
    background: var(--grounded-bg-elevated);
    border-top: 1px solid var(--grounded-border-subtle);
  }

  .grounded-footer a {
    color: inherit;
    text-decoration: none;
    opacity: 0.8;
    transition: opacity var(--grounded-duration-fast);
  }

  .grounded-footer a:hover {
    opacity: 1;
  }

  /* Mobile Responsive */
  @media (max-width: 480px) {
    .grounded-container {
      bottom: var(--grounded-space-md);
      right: var(--grounded-space-md);
    }

    .grounded-container.left {
      left: var(--grounded-space-md);
    }

    .grounded-window {
      width: calc(100vw - var(--grounded-space-xl));
      height: calc(100vh - 32px);
      max-height: none;
      bottom: 0;
    }

    .grounded-window.expanded {
      width: calc(100vw - var(--grounded-space-xl));
      height: calc(100vh - 32px);
    }

    .grounded-launcher {
      width: 52px;
      height: 52px;
    }
  }

  /* Tablet breakpoint for expanded */
  @media (min-width: 481px) and (max-width: 768px) {
    .grounded-window.expanded {
      width: min(580px, calc(100vw - 60px));
      height: min(800px, calc(100vh - 60px));
    }
  }

  /* Status Indicator - Shows retrieval/generation status */
  .grounded-status {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: var(--grounded-space-md);
  }

  .grounded-status-content {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-sm);
    background: var(--grounded-accent-subtle);
    color: var(--grounded-accent);
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    border-radius: var(--grounded-radius-full);
    font-size: 13px;
    font-weight: 500;
  }

  .grounded-status-icon {
    width: 16px;
    height: 16px;
    animation: grounded-pulse 2s ease-in-out infinite;
  }

  .grounded-status-text {
    white-space: nowrap;
  }

  .grounded-status-dots {
    display: flex;
    gap: 4px;
    margin-left: var(--grounded-space-xs);
  }

  .grounded-status-dots .grounded-typing-dot {
    width: 5px;
    height: 5px;
    background: var(--grounded-accent);
  }

  @keyframes grounded-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Inline Citations - Badge Trigger (ai-elements style) */
  .grounded-inline-citation {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--grounded-bg-secondary);
    color: var(--grounded-text-secondary);
    font-size: 11px;
    font-weight: 500;
    font-family: var(--grounded-font-sans);
    padding: 2px 8px;
    border-radius: 9999px;
    margin-left: 4px;
    text-decoration: none;
    cursor: pointer;
    transition: all var(--grounded-duration-fast);
    vertical-align: baseline;
    line-height: 1.4;
    white-space: nowrap;
    border: 1px solid var(--grounded-border);
  }

  .grounded-inline-citation:hover {
    background: var(--grounded-bg-tertiary);
    color: var(--grounded-text-primary);
  }

  /* Citation HoverCard (ai-elements style) */
  .grounded-citation-card {
    position: absolute;
    z-index: 100;
    width: 320px;
    background: var(--grounded-bg-elevated);
    border: 1px solid var(--grounded-border);
    border-radius: var(--grounded-radius-md);
    box-shadow: var(--grounded-shadow-lg);
    overflow: hidden;
    animation: grounded-fade-in var(--grounded-duration-fast) ease-out;
  }

  /* Card Header - like carousel header */
  .grounded-citation-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--grounded-bg-secondary);
    padding: 8px 12px;
    border-radius: var(--grounded-radius-md) var(--grounded-radius-md) 0 0;
  }

  .grounded-citation-card-hostname {
    font-size: 11px;
    font-weight: 500;
    color: var(--grounded-text-tertiary);
  }

  /* Card Body - like InlineCitationSource */
  .grounded-citation-card-body {
    padding: 16px;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .grounded-citation-card-title {
    font-size: 14px;
    font-weight: 500;
    color: var(--grounded-text-primary);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .grounded-citation-card-url {
    font-size: 12px;
    color: var(--grounded-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    word-break: break-all;
  }

  .grounded-citation-card-snippet {
    font-size: 13px;
    color: var(--grounded-text-secondary);
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .grounded-citation-card-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--grounded-accent);
    text-decoration: none;
    transition: opacity var(--grounded-duration-fast);
  }

  .grounded-citation-card-link:hover {
    opacity: 0.8;
  }

  .grounded-citation-card-link svg {
    width: 12px;
    height: 12px;
  }

  /* ============================================
     Agentic Chain of Thought Styles
     ============================================ */
  
  .grounded-agentic-steps {
    margin-bottom: var(--grounded-space-md);
    animation: grounded-fade-in var(--grounded-duration-normal) var(--grounded-ease-out);
  }

  .grounded-agentic-header {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-sm);
    width: 100%;
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    background: var(--grounded-bg-secondary);
    border: none;
    border-radius: var(--grounded-radius-sm);
    font-family: var(--grounded-font-sans);
    font-size: 13px;
    font-weight: 500;
    color: var(--grounded-text-secondary);
    cursor: pointer;
    transition: all var(--grounded-duration-fast);
  }

  .grounded-agentic-header:hover {
    background: var(--grounded-bg-tertiary);
    color: var(--grounded-text-primary);
  }

  .grounded-agentic-header-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--grounded-accent);
  }

  .grounded-agentic-header-text {
    flex: 1;
    text-align: left;
  }

  .grounded-agentic-header-chevron {
    display: flex;
    align-items: center;
    color: var(--grounded-text-tertiary);
  }

  .grounded-agentic-content {
    margin-top: var(--grounded-space-sm);
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    background: var(--grounded-bg-elevated);
    border: 1px solid var(--grounded-border);
    border-radius: var(--grounded-radius-sm);
    animation: grounded-fade-in var(--grounded-duration-fast) var(--grounded-ease-out);
  }

  .grounded-agentic-step {
    display: flex;
    align-items: flex-start;
    gap: var(--grounded-space-sm);
    padding: var(--grounded-space-xs) 0;
    position: relative;
  }

  .grounded-agentic-step-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--grounded-radius-full);
    background: var(--grounded-bg-secondary);
    color: var(--grounded-text-tertiary);
    flex-shrink: 0;
  }

  .grounded-agentic-step-content {
    flex: 1;
    min-width: 0;
    padding-top: 3px;
  }

  .grounded-agentic-step-label {
    font-size: 13px;
    color: var(--grounded-text-secondary);
  }

  .grounded-agentic-step-label.active {
    color: var(--grounded-text-primary);
    font-weight: 500;
  }

  .grounded-agentic-step-line {
    position: absolute;
    left: 11px;
    top: 28px;
    width: 2px;
    height: calc(100% - 4px);
    background: var(--grounded-border);
  }

  /* Agentic Status Indicator (compact inline) */
  .grounded-agentic-status {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-sm);
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    background: var(--grounded-accent-subtle);
    border-radius: var(--grounded-radius-full);
    color: var(--grounded-accent);
    font-size: 13px;
    font-weight: 500;
    margin-bottom: var(--grounded-space-sm);
    animation: grounded-fade-in var(--grounded-duration-fast) var(--grounded-ease-out);
  }

  .grounded-agentic-status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .grounded-agentic-status-text {
    white-space: nowrap;
  }

  /* Spinner animation */
  .grounded-agentic-spinner {
    animation: grounded-spin 1s linear infinite;
  }

  @keyframes grounded-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;class vn{constructor(){this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.mediaQueryListener=null,this.mediaQuery=null,this.processQueue()}processQueue(){const e=window.grounded?.q||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,r){switch(e){case"init":this.init(r);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[Grounded Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[Grounded Widget] Already initialized");return}if(!e?.token){console.error("[Grounded Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase(),colorScheme:e.colorScheme||"auto"},this.container=document.createElement("div"),this.container.id="grounded-widget-root",document.body.appendChild(this.container),this.shadowRoot=this.container.attachShadow({mode:"open"});const r=document.createElement("style");r.textContent=kn,this.shadowRoot.appendChild(r),this.applyTheme(this.options.colorScheme),this.options.colorScheme==="auto"&&this.setupMediaQueryListener();const o=document.createElement("div");this.shadowRoot.appendChild(o),_t(l(Jt,{options:this.options,initialOpen:this.openState,onOpenChange:n=>{this.openState=n,this.openCallback?.(n)}}),o),this.isInitialized=!0,console.log("[Grounded Widget] Initialized with colorScheme:",this.options.colorScheme)}applyTheme(e){if(!this.shadowRoot)return;const r=this.shadowRoot.host;r.classList.remove("light","dark"),e==="light"?r.classList.add("light"):e==="dark"&&r.classList.add("dark")}setupMediaQueryListener(){this.mediaQuery=window.matchMedia("(prefers-color-scheme: dark)"),this.mediaQueryListener=()=>{console.log("[Grounded Widget] System theme changed")},this.mediaQuery.addEventListener("change",this.mediaQueryListener)}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const r of e){const o=r.getAttribute("src");if(o)try{return new URL(o,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){if(!this.shadowRoot||!this.options)return;const e=this.shadowRoot.querySelector("div:last-child");e&&_t(l(Jt,{options:this.options,initialOpen:this.openState,onOpenChange:r=>{this.openState=r,this.openCallback?.(r)}}),e)}destroy(){this.mediaQuery&&this.mediaQueryListener&&this.mediaQuery.removeEventListener("change",this.mediaQueryListener),this.mediaQuery=null,this.mediaQueryListener=null,this.container&&this.container.remove(),this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[Grounded Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const Je=new vn;function er(t,e){Je.handleCommand(t,e)}return window.grounded=er,window.GroundedWidget=Je,fe.GroundedWidget=Je,fe.grounded=er,Object.defineProperty(fe,Symbol.toStringTag,{value:"Module"}),fe})({});
