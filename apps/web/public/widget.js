var GroundedWidget=(function(tt){"use strict";var rt,N,xr,we,kr,vr,yr,wr,Rt,Ct,Lt,Fe={},Sr=[],Qn=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,nt=Array.isArray;function fe(t,e){for(var r in e)t[r]=e[r];return t}function It(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function Vn(t,e,r){var o,n,a,i={};for(a in e)a=="key"?o=e[a]:a=="ref"?n=e[a]:i[a]=e[a];if(arguments.length>2&&(i.children=arguments.length>3?rt.call(arguments,2):r),typeof t=="function"&&t.defaultProps!=null)for(a in t.defaultProps)i[a]===void 0&&(i[a]=t.defaultProps[a]);return ot(t,i,o,n,null)}function ot(t,e,r,o,n){var a={type:t,props:e,key:r,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++xr,__i:-1,__u:0};return n==null&&N.vnode!=null&&N.vnode(a),a}function Se(t){return t.children}function at(t,e){this.props=t,this.context=e}function Ie(t,e){if(e==null)return t.__?Ie(t.__,t.__i+1):null;for(var r;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null)return r.__e;return typeof t.type=="function"?Ie(t):null}function Tr(t){var e,r;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null){t.__e=t.__c.base=r.__e;break}return Tr(t)}}function Ar(t){(!t.__d&&(t.__d=!0)&&we.push(t)&&!it.__r++||kr!=N.debounceRendering)&&((kr=N.debounceRendering)||vr)(it)}function it(){for(var t,e,r,o,n,a,i,c=1;we.length;)we.length>c&&we.sort(yr),t=we.shift(),c=we.length,t.__d&&(r=void 0,o=void 0,n=(o=(e=t).__v).__e,a=[],i=[],e.__P&&((r=fe({},o)).__v=o.__v+1,N.vnode&&N.vnode(r),Nt(e.__P,r,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,a,n??Ie(o),!!(32&o.__u),i),r.__v=o.__v,r.__.__k[r.__i]=r,Ir(a,r,i),o.__e=o.__=null,r.__e!=n&&Tr(r)));it.__r=0}function Er(t,e,r,o,n,a,i,c,l,u,p){var g,f,m,_,v,S,y,k=o&&o.__k||Sr,L=e.length;for(l=Kn(r,e,k,l,L),g=0;g<L;g++)(m=r.__k[g])!=null&&(f=m.__i==-1?Fe:k[m.__i]||Fe,m.__i=g,S=Nt(t,m,f,n,a,i,c,l,u,p),_=m.__e,m.ref&&f.ref!=m.ref&&(f.ref&&$t(f.ref,null,m),p.push(m.ref,m.__c||_,m)),v==null&&_!=null&&(v=_),(y=!!(4&m.__u))||f.__k===m.__k?l=Rr(m,l,t,y):typeof m.type=="function"&&S!==void 0?l=S:_&&(l=_.nextSibling),m.__u&=-7);return r.__e=v,l}function Kn(t,e,r,o,n){var a,i,c,l,u,p=r.length,g=p,f=0;for(t.__k=new Array(n),a=0;a<n;a++)(i=e[a])!=null&&typeof i!="boolean"&&typeof i!="function"?(typeof i=="string"||typeof i=="number"||typeof i=="bigint"||i.constructor==String?i=t.__k[a]=ot(null,i,null,null,null):nt(i)?i=t.__k[a]=ot(Se,{children:i},null,null,null):i.constructor===void 0&&i.__b>0?i=t.__k[a]=ot(i.type,i.props,i.key,i.ref?i.ref:null,i.__v):t.__k[a]=i,l=a+f,i.__=t,i.__b=t.__b+1,c=null,(u=i.__i=Jn(i,r,l,g))!=-1&&(g--,(c=r[u])&&(c.__u|=2)),c==null||c.__v==null?(u==-1&&(n>p?f--:n<p&&f++),typeof i.type!="function"&&(i.__u|=4)):u!=l&&(u==l-1?f--:u==l+1?f++:(u>l?f--:f++,i.__u|=4))):t.__k[a]=null;if(g)for(a=0;a<p;a++)(c=r[a])!=null&&(2&c.__u)==0&&(c.__e==o&&(o=Ie(c)),Mr(c,c));return o}function Rr(t,e,r,o){var n,a;if(typeof t.type=="function"){for(n=t.__k,a=0;n&&a<n.length;a++)n[a]&&(n[a].__=t,e=Rr(n[a],e,r,o));return e}t.__e!=e&&(o&&(e&&t.type&&!e.parentNode&&(e=Ie(t)),r.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function Jn(t,e,r,o){var n,a,i,c=t.key,l=t.type,u=e[r],p=u!=null&&(2&u.__u)==0;if(u===null&&c==null||p&&c==u.key&&l==u.type)return r;if(o>(p?1:0)){for(n=r-1,a=r+1;n>=0||a<e.length;)if((u=e[i=n>=0?n--:a++])!=null&&(2&u.__u)==0&&c==u.key&&l==u.type)return i}return-1}function Cr(t,e,r){e[0]=="-"?t.setProperty(e,r??""):t[e]=r==null?"":typeof r!="number"||Qn.test(e)?r:r+"px"}function st(t,e,r,o,n){var a,i;e:if(e=="style")if(typeof r=="string")t.style.cssText=r;else{if(typeof o=="string"&&(t.style.cssText=o=""),o)for(e in o)r&&e in r||Cr(t.style,e,"");if(r)for(e in r)o&&r[e]==o[e]||Cr(t.style,e,r[e])}else if(e[0]=="o"&&e[1]=="n")a=e!=(e=e.replace(wr,"$1")),i=e.toLowerCase(),e=i in t||e=="onFocusOut"||e=="onFocusIn"?i.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+a]=r,r?o?r.u=o.u:(r.u=Rt,t.addEventListener(e,a?Lt:Ct,a)):t.removeEventListener(e,a?Lt:Ct,a);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&r==1?"":r))}}function Lr(t){return function(e){if(this.l){var r=this.l[e.type+t];if(e.t==null)e.t=Rt++;else if(e.t<r.u)return;return r(N.event?N.event(e):e)}}}function Nt(t,e,r,o,n,a,i,c,l,u){var p,g,f,m,_,v,S,y,k,L,R,z,U,ce,se,W,ue,C=e.type;if(e.constructor!==void 0)return null;128&r.__u&&(l=!!(32&r.__u),a=[c=e.__e=r.__e]),(p=N.__b)&&p(e);e:if(typeof C=="function")try{if(y=e.props,k="prototype"in C&&C.prototype.render,L=(p=C.contextType)&&o[p.__c],R=p?L?L.props.value:p.__:o,r.__c?S=(g=e.__c=r.__c).__=g.__E:(k?e.__c=g=new C(y,R):(e.__c=g=new at(y,R),g.constructor=C,g.render=to),L&&L.sub(g),g.state||(g.state={}),g.__n=o,f=g.__d=!0,g.__h=[],g._sb=[]),k&&g.__s==null&&(g.__s=g.state),k&&C.getDerivedStateFromProps!=null&&(g.__s==g.state&&(g.__s=fe({},g.__s)),fe(g.__s,C.getDerivedStateFromProps(y,g.__s))),m=g.props,_=g.state,g.__v=e,f)k&&C.getDerivedStateFromProps==null&&g.componentWillMount!=null&&g.componentWillMount(),k&&g.componentDidMount!=null&&g.__h.push(g.componentDidMount);else{if(k&&C.getDerivedStateFromProps==null&&y!==m&&g.componentWillReceiveProps!=null&&g.componentWillReceiveProps(y,R),e.__v==r.__v||!g.__e&&g.shouldComponentUpdate!=null&&g.shouldComponentUpdate(y,g.__s,R)===!1){for(e.__v!=r.__v&&(g.props=y,g.state=g.__s,g.__d=!1),e.__e=r.__e,e.__k=r.__k,e.__k.some(function(Q){Q&&(Q.__=e)}),z=0;z<g._sb.length;z++)g.__h.push(g._sb[z]);g._sb=[],g.__h.length&&i.push(g);break e}g.componentWillUpdate!=null&&g.componentWillUpdate(y,g.__s,R),k&&g.componentDidUpdate!=null&&g.__h.push(function(){g.componentDidUpdate(m,_,v)})}if(g.context=R,g.props=y,g.__P=t,g.__e=!1,U=N.__r,ce=0,k){for(g.state=g.__s,g.__d=!1,U&&U(e),p=g.render(g.props,g.state,g.context),se=0;se<g._sb.length;se++)g.__h.push(g._sb[se]);g._sb=[]}else do g.__d=!1,U&&U(e),p=g.render(g.props,g.state,g.context),g.state=g.__s;while(g.__d&&++ce<25);g.state=g.__s,g.getChildContext!=null&&(o=fe(fe({},o),g.getChildContext())),k&&!f&&g.getSnapshotBeforeUpdate!=null&&(v=g.getSnapshotBeforeUpdate(m,_)),W=p,p!=null&&p.type===Se&&p.key==null&&(W=Nr(p.props.children)),c=Er(t,nt(W)?W:[W],e,r,o,n,a,i,c,l,u),g.base=e.__e,e.__u&=-161,g.__h.length&&i.push(g),S&&(g.__E=g.__=null)}catch(Q){if(e.__v=null,l||a!=null)if(Q.then){for(e.__u|=l?160:128;c&&c.nodeType==8&&c.nextSibling;)c=c.nextSibling;a[a.indexOf(c)]=null,e.__e=c}else{for(ue=a.length;ue--;)It(a[ue]);Mt(e)}else e.__e=r.__e,e.__k=r.__k,Q.then||Mt(e);N.__e(Q,e,r)}else a==null&&e.__v==r.__v?(e.__k=r.__k,e.__e=r.__e):c=e.__e=eo(r.__e,e,r,o,n,a,i,l,u);return(p=N.diffed)&&p(e),128&e.__u?void 0:c}function Mt(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Mt)}function Ir(t,e,r){for(var o=0;o<r.length;o++)$t(r[o],r[++o],r[++o]);N.__c&&N.__c(e,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(a){a.call(n)})}catch(a){N.__e(a,n.__v)}})}function Nr(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:nt(t)?t.map(Nr):fe({},t)}function eo(t,e,r,o,n,a,i,c,l){var u,p,g,f,m,_,v,S=r.props||Fe,y=e.props,k=e.type;if(k=="svg"?n="http://www.w3.org/2000/svg":k=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),a!=null){for(u=0;u<a.length;u++)if((m=a[u])&&"setAttribute"in m==!!k&&(k?m.localName==k:m.nodeType==3)){t=m,a[u]=null;break}}if(t==null){if(k==null)return document.createTextNode(y);t=document.createElementNS(n,k,y.is&&y),c&&(N.__m&&N.__m(e,a),c=!1),a=null}if(k==null)S===y||c&&t.data==y||(t.data=y);else{if(a=a&&rt.call(t.childNodes),!c&&a!=null)for(S={},u=0;u<t.attributes.length;u++)S[(m=t.attributes[u]).name]=m.value;for(u in S)if(m=S[u],u!="children"){if(u=="dangerouslySetInnerHTML")g=m;else if(!(u in y)){if(u=="value"&&"defaultValue"in y||u=="checked"&&"defaultChecked"in y)continue;st(t,u,null,m,n)}}for(u in y)m=y[u],u=="children"?f=m:u=="dangerouslySetInnerHTML"?p=m:u=="value"?_=m:u=="checked"?v=m:c&&typeof m!="function"||S[u]===m||st(t,u,m,S[u],n);if(p)c||g&&(p.__html==g.__html||p.__html==t.innerHTML)||(t.innerHTML=p.__html),e.__k=[];else if(g&&(t.innerHTML=""),Er(e.type=="template"?t.content:t,nt(f)?f:[f],e,r,o,k=="foreignObject"?"http://www.w3.org/1999/xhtml":n,a,i,a?a[0]:r.__k&&Ie(r,0),c,l),a!=null)for(u=a.length;u--;)It(a[u]);c||(u="value",k=="progress"&&_==null?t.removeAttribute("value"):_!=null&&(_!==t[u]||k=="progress"&&!_||k=="option"&&_!=S[u])&&st(t,u,_,S[u],n),u="checked",v!=null&&v!=t[u]&&st(t,u,v,S[u],n))}return t}function $t(t,e,r){try{if(typeof t=="function"){var o=typeof t.__u=="function";o&&t.__u(),o&&e==null||(t.__u=t(e))}else t.current=e}catch(n){N.__e(n,r)}}function Mr(t,e,r){var o,n;if(N.unmount&&N.unmount(t),(o=t.ref)&&(o.current&&o.current!=t.__e||$t(o,null,e)),(o=t.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(a){N.__e(a,e)}o.base=o.__P=null}if(o=t.__k)for(n=0;n<o.length;n++)o[n]&&Mr(o[n],e,r||typeof t.type!="function");r||It(t.__e),t.__c=t.__=t.__e=void 0}function to(t,e,r){return this.constructor(t,r)}function $r(t,e,r){var o,n,a,i;e==document&&(e=document.documentElement),N.__&&N.__(t,e),n=(o=!1)?null:e.__k,a=[],i=[],Nt(e,t=e.__k=Vn(Se,null,[t]),n||Fe,Fe,e.namespaceURI,n?null:e.firstChild?rt.call(e.childNodes):null,a,n?n.__e:e.firstChild,o,i),Ir(a,t,i)}rt=Sr.slice,N={__e:function(t,e,r,o){for(var n,a,i;e=e.__;)if((n=e.__c)&&!n.__)try{if((a=n.constructor)&&a.getDerivedStateFromError!=null&&(n.setState(a.getDerivedStateFromError(t)),i=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(t,o||{}),i=n.__d),i)return n.__E=n}catch(c){t=c}throw t}},xr=0,at.prototype.setState=function(t,e){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=fe({},this.state),typeof t=="function"&&(t=t(fe({},r),this.props)),t&&fe(r,t),t!=null&&this.__v&&(e&&this._sb.push(e),Ar(this))},at.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),Ar(this))},at.prototype.render=Se,we=[],vr=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,yr=function(t,e){return t.__v.__b-e.__v.__b},it.__r=0,wr=/(PointerCapture)$|Capture$/i,Rt=0,Ct=Lr(!1),Lt=Lr(!0);var ro=0;function d(t,e,r,o,n,a){e||(e={});var i,c,l=e;if("ref"in l)for(c in l={},e)c=="ref"?i=e[c]:l[c]=e[c];var u={type:t,props:l,key:r,ref:i,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--ro,__i:-1,__u:0,__source:n,__self:a};if(typeof t=="function"&&(i=t.defaultProps))for(c in i)l[c]===void 0&&(l[c]=i[c]);return N.vnode&&N.vnode(u),u}var Be,O,zt,zr,He=0,Dr=[],F=N,Or=F.__b,Pr=F.__r,Fr=F.diffed,Br=F.__c,Hr=F.unmount,Ur=F.__;function Dt(t,e){F.__h&&F.__h(O,t,He||e),He=0;var r=O.__H||(O.__H={__:[],__h:[]});return t>=r.__.length&&r.__.push({}),r.__[t]}function V(t){return He=1,no(qr,t)}function no(t,e,r){var o=Dt(Be++,2);if(o.t=t,!o.__c&&(o.__=[qr(void 0,e),function(c){var l=o.__N?o.__N[0]:o.__[0],u=o.t(l,c);l!==u&&(o.__N=[u,o.__[1]],o.__c.setState({}))}],o.__c=O,!O.__f)){var n=function(c,l,u){if(!o.__c.__H)return!0;var p=o.__c.__H.__.filter(function(f){return!!f.__c});if(p.every(function(f){return!f.__N}))return!a||a.call(this,c,l,u);var g=o.__c.props!==c;return p.forEach(function(f){if(f.__N){var m=f.__[0];f.__=f.__N,f.__N=void 0,m!==f.__[0]&&(g=!0)}}),a&&a.call(this,c,l,u)||g};O.__f=!0;var a=O.shouldComponentUpdate,i=O.componentWillUpdate;O.componentWillUpdate=function(c,l,u){if(this.__e){var p=a;a=void 0,n(c,l,u),a=p}i&&i.call(this,c,l,u)},O.shouldComponentUpdate=n}return o.__N||o.__}function Ue(t,e){var r=Dt(Be++,3);!F.__s&&jr(r.__H,e)&&(r.__=t,r.u=e,O.__H.__h.push(r))}function Te(t){return He=5,Wr(function(){return{current:t}},[])}function Wr(t,e){var r=Dt(Be++,7);return jr(r.__H,e)&&(r.__=t(),r.__H=e,r.__h=t),r.__}function Ot(t,e){return He=8,Wr(function(){return t},e)}function oo(){for(var t;t=Dr.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(lt),t.__H.__h.forEach(Pt),t.__H.__h=[]}catch(e){t.__H.__h=[],F.__e(e,t.__v)}}F.__b=function(t){O=null,Or&&Or(t)},F.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),Ur&&Ur(t,e)},F.__r=function(t){Pr&&Pr(t),Be=0;var e=(O=t.__c).__H;e&&(zt===O?(e.__h=[],O.__h=[],e.__.forEach(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(e.__h.forEach(lt),e.__h.forEach(Pt),e.__h=[],Be=0)),zt=O},F.diffed=function(t){Fr&&Fr(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(Dr.push(e)!==1&&zr===F.requestAnimationFrame||((zr=F.requestAnimationFrame)||ao)(oo)),e.__H.__.forEach(function(r){r.u&&(r.__H=r.u),r.u=void 0})),zt=O=null},F.__c=function(t,e){e.some(function(r){try{r.__h.forEach(lt),r.__h=r.__h.filter(function(o){return!o.__||Pt(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],F.__e(o,r.__v)}}),Br&&Br(t,e)},F.unmount=function(t){Hr&&Hr(t);var e,r=t.__c;r&&r.__H&&(r.__H.__.forEach(function(o){try{lt(o)}catch(n){e=n}}),r.__H=void 0,e&&F.__e(e,r.__v))};var Gr=typeof requestAnimationFrame=="function";function ao(t){var e,r=function(){clearTimeout(o),Gr&&cancelAnimationFrame(e),setTimeout(t)},o=setTimeout(r,35);Gr&&(e=requestAnimationFrame(r))}function lt(t){var e=O,r=t.__c;typeof r=="function"&&(t.__c=void 0,r()),O=e}function Pt(t){var e=O;t.__c=t.__(),O=e}function jr(t,e){return!t||t.length!==e.length||e.some(function(r,o){return r!==t[o]})}function qr(t,e){return typeof e=="function"?e(t):e}function io({token:t,apiBase:e,endpointType:r="widget"}){const[o,n]=V([]),[a,i]=V(!1),[c,l]=V(!1),[u,p]=V(null),[g,f]=V({status:"idle"}),[m,_]=V([]),v=Te(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),S=Te(null),y=Te(null),k=Te(new Map),L=()=>Math.random().toString(36).slice(2,11),R=Ot(async ce=>{if(!ce.trim()||a||c)return;const se={id:L(),role:"user",content:ce.trim(),timestamp:Date.now()},W=L();n(K=>[...K,se]),i(!0),l(!0),p(null),f({status:"searching",message:"Searching knowledge base..."}),_([]),y.current=null,k.current.clear(),S.current=new AbortController;const ue=6e4;let C;const Q=()=>{clearTimeout(C),C=setTimeout(()=>S.current?.abort(),ue)};try{const K={message:ce.trim()};v.current&&(K.conversationId=v.current);const le=r==="chat-endpoint"?`${e}/api/v1/c/${t}/chat/stream`:`${e}/api/v1/widget/${t}/chat/stream`;Q();const be=await fetch(le,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(K),signal:S.current.signal});if(!be.ok){const ge=await be.json().catch(()=>({}));throw new Error(ge.message||`Request failed: ${be.status}`)}n(ge=>[...ge,{id:W,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),i(!1);const ne=be.body?.getReader();if(!ne)throw new Error("No response body");const Ne=new TextDecoder;let ye="",_e="";for(;;){Q();const{done:ge,value:D}=await ne.read();if(ge)break;ye+=Ne.decode(D,{stream:!0});const Re=ye.split(`
`);ye=Re.pop()||"";for(const $ of Re)if($.startsWith("data: "))try{const I=JSON.parse($.slice(6));if(I.type==="status"){const T=I.status==="searching"?"searching":I.status==="generating"?"generating":"searching";f({status:T,message:I.message,sourcesCount:I.sourcesCount})}else if(I.type==="sources"&&I.sources)y.current=I.sources.map(T=>({index:T.index,title:T.title,url:T.url,snippet:T.snippet}));else if(I.type==="reasoning"&&I.step)k.current.set(I.step.id,I.step),_(Array.from(k.current.values()));else if(I.type==="text"&&I.content)_e||f({status:"streaming"}),_e+=I.content,n(T=>T.map(ee=>ee.id===W?{...ee,content:_e}:ee));else if(I.type==="done"){if(I.conversationId){v.current=I.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,I.conversationId)}catch{}}const T=y.current?[...y.current]:[];y.current=null,k.current.clear(),n(ee=>ee.map(P=>P.id===W?{...P,content:_e,isStreaming:!1,citations:T}:P)),f({status:"idle"})}else if(I.type==="error")throw new Error(I.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",$)}}}catch(K){if(k.current.clear(),_([]),K.name==="AbortError"){f({status:"idle"}),S.current&&p("Connection timed out. Please try again.");return}f({status:"idle"}),p(K instanceof Error?K.message:"An error occurred"),n(le=>le.some(ne=>ne.id===W)?le.map(ne=>ne.id===W?{...ne,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:ne):[...le,{id:W,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{clearTimeout(C),i(!1),l(!1),S.current=null}},[t,e,a,c]),z=Ot(()=>{S.current&&(S.current.abort(),S.current=null),l(!1),i(!1)},[]),U=Ot(()=>{n([]),v.current=null,k.current.clear(),_([]);try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:o,isLoading:a,isStreaming:c,error:u,chatStatus:g,currentReasoningSteps:m,sendMessage:R,stopStreaming:z,clearMessages:U}}function so({token:t,apiBase:e,enabled:r=!0}){const[o,n]=V(null),[a,i]=V(!0),[c,l]=V(null);return Ue(()=>{if(!r)return;async function u(){i(!0);try{const p=await fetch(`${e}/api/v1/widget/${t}/config`);if(!p.ok)throw new Error("Failed to load widget configuration");const g=await p.json();n(g)}catch(p){l(p instanceof Error?p.message:"Configuration error"),n({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0,ragType:"simple",showReasoningSteps:!0})}finally{i(!1)}}u()},[t,e,r]),{config:o,isLoading:a,error:c}}function Ft(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var Ae=Ft();function Yr(t){Ae=t}var We={exec:()=>null};function A(t,e=""){let r=typeof t=="string"?t:t.source,o={replace:(n,a)=>{let i=typeof a=="string"?a:a.source;return i=i.replace(q.caret,"$1"),r=r.replace(n,i),o},getRegex:()=>new RegExp(r,e)};return o}var lo=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),q={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},co=/^(?:[ \t]*(?:\n|$))+/,uo=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,go=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,Ge=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,po=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Bt=/(?:[*+-]|\d{1,9}[.)])/,Zr=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,Xr=A(Zr).replace(/bull/g,Bt).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),ho=A(Zr).replace(/bull/g,Bt).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Ht=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,fo=/^[^\n]+/,Ut=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,mo=A(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",Ut).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),bo=A(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Bt).getRegex(),dt="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Wt=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,_o=A("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",Wt).replace("tag",dt).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),Qr=A(Ht).replace("hr",Ge).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",dt).getRegex(),xo=A(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",Qr).getRegex(),Gt={blockquote:xo,code:uo,def:mo,fences:go,heading:po,hr:Ge,html:_o,lheading:Xr,list:bo,newline:co,paragraph:Qr,table:We,text:fo},Vr=A("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",Ge).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",dt).getRegex(),ko={...Gt,lheading:ho,table:Vr,paragraph:A(Ht).replace("hr",Ge).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Vr).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",dt).getRegex()},vo={...Gt,html:A(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",Wt).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:We,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:A(Ht).replace("hr",Ge).replace("heading",` *#{1,6} *[^
]`).replace("lheading",Xr).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},yo=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,wo=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,Kr=/^( {2,}|\\)\n(?!\s*$)/,So=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,ct=/[\p{P}\p{S}]/u,jt=/[\s\p{P}\p{S}]/u,Jr=/[^\s\p{P}\p{S}]/u,To=A(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,jt).getRegex(),en=/(?!~)[\p{P}\p{S}]/u,Ao=/(?!~)[\s\p{P}\p{S}]/u,Eo=/(?:[^\s\p{P}\p{S}]|~)/u,Ro=A(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",lo?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),tn=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,Co=A(tn,"u").replace(/punct/g,ct).getRegex(),Lo=A(tn,"u").replace(/punct/g,en).getRegex(),rn="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Io=A(rn,"gu").replace(/notPunctSpace/g,Jr).replace(/punctSpace/g,jt).replace(/punct/g,ct).getRegex(),No=A(rn,"gu").replace(/notPunctSpace/g,Eo).replace(/punctSpace/g,Ao).replace(/punct/g,en).getRegex(),Mo=A("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Jr).replace(/punctSpace/g,jt).replace(/punct/g,ct).getRegex(),$o=A(/\\(punct)/,"gu").replace(/punct/g,ct).getRegex(),zo=A(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Do=A(Wt).replace("(?:-->|$)","-->").getRegex(),Oo=A("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Do).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),ut=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,Po=A(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",ut).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),nn=A(/^!?\[(label)\]\[(ref)\]/).replace("label",ut).replace("ref",Ut).getRegex(),on=A(/^!?\[(ref)\](?:\[\])?/).replace("ref",Ut).getRegex(),Fo=A("reflink|nolink(?!\\()","g").replace("reflink",nn).replace("nolink",on).getRegex(),an=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,qt={_backpedal:We,anyPunctuation:$o,autolink:zo,blockSkip:Ro,br:Kr,code:wo,del:We,emStrongLDelim:Co,emStrongRDelimAst:Io,emStrongRDelimUnd:Mo,escape:yo,link:Po,nolink:on,punctuation:To,reflink:nn,reflinkSearch:Fo,tag:Oo,text:So,url:We},Bo={...qt,link:A(/^!?\[(label)\]\((.*?)\)/).replace("label",ut).getRegex(),reflink:A(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",ut).getRegex()},Yt={...qt,emStrongRDelimAst:No,emStrongLDelim:Lo,url:A(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",an).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:A(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",an).getRegex()},Ho={...Yt,br:A(Kr).replace("{2,}","*").getRegex(),text:A(Yt.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},gt={normal:Gt,gfm:ko,pedantic:vo},je={normal:qt,gfm:Yt,breaks:Ho,pedantic:Bo},Uo={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},sn=t=>Uo[t];function me(t,e){if(e){if(q.escapeTest.test(t))return t.replace(q.escapeReplace,sn)}else if(q.escapeTestNoEncode.test(t))return t.replace(q.escapeReplaceNoEncode,sn);return t}function ln(t){try{t=encodeURI(t).replace(q.percentDecode,"%")}catch{return null}return t}function dn(t,e){let r=t.replace(q.findPipe,(a,i,c)=>{let l=!1,u=i;for(;--u>=0&&c[u]==="\\";)l=!l;return l?"|":" |"}),o=r.split(q.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(q.slashPipe,"|");return o}function qe(t,e,r){let o=t.length;if(o===0)return"";let n=0;for(;n<o&&t.charAt(o-n-1)===e;)n++;return t.slice(0,o-n)}function Wo(t,e){if(t.indexOf(e[1])===-1)return-1;let r=0;for(let o=0;o<t.length;o++)if(t[o]==="\\")o++;else if(t[o]===e[0])r++;else if(t[o]===e[1]&&(r--,r<0))return o;return r>0?-2:-1}function cn(t,e,r,o,n){let a=e.href,i=e.title||null,c=t[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let l={type:t[0].charAt(0)==="!"?"image":"link",raw:r,href:a,title:i,text:c,tokens:o.inlineTokens(c)};return o.state.inLink=!1,l}function Go(t,e,r){let o=t.match(r.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(a=>{let i=a.match(r.other.beginningSpace);if(i===null)return a;let[c]=i;return c.length>=n.length?a.slice(n.length):a}).join(`
`)}var pt=class{options;rules;lexer;constructor(t){this.options=t||Ae}space(t){let e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){let e=this.rules.block.code.exec(t);if(e){let r=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?r:qe(r,`
`)}}}fences(t){let e=this.rules.block.fences.exec(t);if(e){let r=e[0],o=Go(r,e[3]||"",this.rules);return{type:"code",raw:r,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(t){let e=this.rules.block.heading.exec(t);if(e){let r=e[2].trim();if(this.rules.other.endingHash.test(r)){let o=qe(r,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(r=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:r,tokens:this.lexer.inline(r)}}}hr(t){let e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:qe(e[0],`
`)}}blockquote(t){let e=this.rules.block.blockquote.exec(t);if(e){let r=qe(e[0],`
`).split(`
`),o="",n="",a=[];for(;r.length>0;){let i=!1,c=[],l;for(l=0;l<r.length;l++)if(this.rules.other.blockquoteStart.test(r[l]))c.push(r[l]),i=!0;else if(!i)c.push(r[l]);else break;r=r.slice(l);let u=c.join(`
`),p=u.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${u}`:u,n=n?`${n}
${p}`:p;let g=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(p,a,!0),this.lexer.state.top=g,r.length===0)break;let f=a.at(-1);if(f?.type==="code")break;if(f?.type==="blockquote"){let m=f,_=m.raw+`
`+r.join(`
`),v=this.blockquote(_);a[a.length-1]=v,o=o.substring(0,o.length-m.raw.length)+v.raw,n=n.substring(0,n.length-m.text.length)+v.text;break}else if(f?.type==="list"){let m=f,_=m.raw+`
`+r.join(`
`),v=this.list(_);a[a.length-1]=v,o=o.substring(0,o.length-f.raw.length)+v.raw,n=n.substring(0,n.length-m.raw.length)+v.raw,r=_.substring(a.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:a,text:n}}}list(t){let e=this.rules.block.list.exec(t);if(e){let r=e[1].trim(),o=r.length>1,n={type:"list",raw:"",ordered:o,start:o?+r.slice(0,-1):"",loose:!1,items:[]};r=o?`\\d{1,9}\\${r.slice(-1)}`:`\\${r}`,this.options.pedantic&&(r=o?r:"[*+-]");let a=this.rules.other.listItemRegex(r),i=!1;for(;t;){let l=!1,u="",p="";if(!(e=a.exec(t))||this.rules.block.hr.test(t))break;u=e[0],t=t.substring(u.length);let g=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,v=>" ".repeat(3*v.length)),f=t.split(`
`,1)[0],m=!g.trim(),_=0;if(this.options.pedantic?(_=2,p=g.trimStart()):m?_=e[1].length+1:(_=e[2].search(this.rules.other.nonSpaceChar),_=_>4?1:_,p=g.slice(_),_+=e[1].length),m&&this.rules.other.blankLine.test(f)&&(u+=f+`
`,t=t.substring(f.length+1),l=!0),!l){let v=this.rules.other.nextBulletRegex(_),S=this.rules.other.hrRegex(_),y=this.rules.other.fencesBeginRegex(_),k=this.rules.other.headingBeginRegex(_),L=this.rules.other.htmlBeginRegex(_);for(;t;){let R=t.split(`
`,1)[0],z;if(f=R,this.options.pedantic?(f=f.replace(this.rules.other.listReplaceNesting,"  "),z=f):z=f.replace(this.rules.other.tabCharGlobal,"    "),y.test(f)||k.test(f)||L.test(f)||v.test(f)||S.test(f))break;if(z.search(this.rules.other.nonSpaceChar)>=_||!f.trim())p+=`
`+z.slice(_);else{if(m||g.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||y.test(g)||k.test(g)||S.test(g))break;p+=`
`+f}!m&&!f.trim()&&(m=!0),u+=R+`
`,t=t.substring(R.length+1),g=z.slice(_)}}n.loose||(i?n.loose=!0:this.rules.other.doubleBlankLine.test(u)&&(i=!0)),n.items.push({type:"list_item",raw:u,task:!!this.options.gfm&&this.rules.other.listIsTask.test(p),loose:!1,text:p,tokens:[]}),n.raw+=u}let c=n.items.at(-1);if(c)c.raw=c.raw.trimEnd(),c.text=c.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let l of n.items){if(this.lexer.state.top=!1,l.tokens=this.lexer.blockTokens(l.text,[]),l.task){if(l.text=l.text.replace(this.rules.other.listReplaceTask,""),l.tokens[0]?.type==="text"||l.tokens[0]?.type==="paragraph"){l.tokens[0].raw=l.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),l.tokens[0].text=l.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let p=this.lexer.inlineQueue.length-1;p>=0;p--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[p].src)){this.lexer.inlineQueue[p].src=this.lexer.inlineQueue[p].src.replace(this.rules.other.listReplaceTask,"");break}}let u=this.rules.other.listTaskCheckbox.exec(l.raw);if(u){let p={type:"checkbox",raw:u[0]+" ",checked:u[0]!=="[ ]"};l.checked=p.checked,n.loose?l.tokens[0]&&["paragraph","text"].includes(l.tokens[0].type)&&"tokens"in l.tokens[0]&&l.tokens[0].tokens?(l.tokens[0].raw=p.raw+l.tokens[0].raw,l.tokens[0].text=p.raw+l.tokens[0].text,l.tokens[0].tokens.unshift(p)):l.tokens.unshift({type:"paragraph",raw:p.raw,text:p.raw,tokens:[p]}):l.tokens.unshift(p)}}if(!n.loose){let u=l.tokens.filter(g=>g.type==="space"),p=u.length>0&&u.some(g=>this.rules.other.anyLine.test(g.raw));n.loose=p}}if(n.loose)for(let l of n.items){l.loose=!0;for(let u of l.tokens)u.type==="text"&&(u.type="paragraph")}return n}}html(t){let e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){let e=this.rules.block.def.exec(t);if(e){let r=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:r,raw:e[0],href:o,title:n}}}table(t){let e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let r=dn(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],a={type:"table",raw:e[0],header:[],align:[],rows:[]};if(r.length===o.length){for(let i of o)this.rules.other.tableAlignRight.test(i)?a.align.push("right"):this.rules.other.tableAlignCenter.test(i)?a.align.push("center"):this.rules.other.tableAlignLeft.test(i)?a.align.push("left"):a.align.push(null);for(let i=0;i<r.length;i++)a.header.push({text:r[i],tokens:this.lexer.inline(r[i]),header:!0,align:a.align[i]});for(let i of n)a.rows.push(dn(i,a.header.length).map((c,l)=>({text:c,tokens:this.lexer.inline(c),header:!1,align:a.align[l]})));return a}}lheading(t){let e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){let e=this.rules.block.paragraph.exec(t);if(e){let r=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:r,tokens:this.lexer.inline(r)}}}text(t){let e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){let e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){let e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){let e=this.rules.inline.link.exec(t);if(e){let r=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let a=qe(r.slice(0,-1),"\\");if((r.length-a.length)%2===0)return}else{let a=Wo(e[2],"()");if(a===-2)return;if(a>-1){let i=(e[0].indexOf("!")===0?5:4)+e[1].length+a;e[2]=e[2].substring(0,a),e[0]=e[0].substring(0,i).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(o);a&&(o=a[1],n=a[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?o=o.slice(1):o=o.slice(1,-1)),cn(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let r;if((r=this.rules.inline.reflink.exec(t))||(r=this.rules.inline.nolink.exec(t))){let o=(r[2]||r[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let a=r[0].charAt(0);return{type:"text",raw:a,text:a}}return cn(r,n,r[0],this.lexer,this.rules)}}emStrong(t,e,r=""){let o=this.rules.inline.emStrongLDelim.exec(t);if(!(!o||o[3]&&r.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!r||this.rules.inline.punctuation.exec(r))){let n=[...o[0]].length-1,a,i,c=n,l=0,u=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(u.lastIndex=0,e=e.slice(-1*t.length+n);(o=u.exec(e))!=null;){if(a=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!a)continue;if(i=[...a].length,o[3]||o[4]){c+=i;continue}else if((o[5]||o[6])&&n%3&&!((n+i)%3)){l+=i;continue}if(c-=i,c>0)continue;i=Math.min(i,i+c+l);let p=[...o[0]][0].length,g=t.slice(0,n+o.index+p+i);if(Math.min(n,i)%2){let m=g.slice(1,-1);return{type:"em",raw:g,text:m,tokens:this.lexer.inlineTokens(m)}}let f=g.slice(2,-2);return{type:"strong",raw:g,text:f,tokens:this.lexer.inlineTokens(f)}}}}codespan(t){let e=this.rules.inline.code.exec(t);if(e){let r=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(r),n=this.rules.other.startingSpaceChar.test(r)&&this.rules.other.endingSpaceChar.test(r);return o&&n&&(r=r.substring(1,r.length-1)),{type:"codespan",raw:e[0],text:r}}}br(t){let e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){let e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){let e=this.rules.inline.autolink.exec(t);if(e){let r,o;return e[2]==="@"?(r=e[1],o="mailto:"+r):(r=e[1],o=r),{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}url(t){let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){let e=this.rules.inline.text.exec(t);if(e){let r=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:r}}}},oe=class br{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||Ae,this.options.tokenizer=this.options.tokenizer||new pt,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let r={other:q,block:gt.normal,inline:je.normal};this.options.pedantic?(r.block=gt.pedantic,r.inline=je.pedantic):this.options.gfm&&(r.block=gt.gfm,this.options.breaks?r.inline=je.breaks:r.inline=je.gfm),this.tokenizer.rules=r}static get rules(){return{block:gt,inline:je}}static lex(e,r){return new br(r).lex(e)}static lexInline(e,r){return new br(r).inlineTokens(e)}lex(e){e=e.replace(q.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let r=0;r<this.inlineQueue.length;r++){let o=this.inlineQueue[r];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,r=[],o=!1){for(this.options.pedantic&&(e=e.replace(q.tabCharGlobal,"    ").replace(q.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(i=>(n=i.call({lexer:this},e,r))?(e=e.substring(n.raw.length),r.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let i=r.at(-1);n.raw.length===1&&i!==void 0?i.raw+=`
`:r.push(n);continue}if(n=this.tokenizer.code(e)){e=e.substring(n.raw.length);let i=r.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.text,this.inlineQueue.at(-1).src=i.text):r.push(n);continue}if(n=this.tokenizer.fences(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.heading(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.hr(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.blockquote(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.list(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.html(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.def(e)){e=e.substring(n.raw.length);let i=r.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.raw,this.inlineQueue.at(-1).src=i.text):this.tokens.links[n.tag]||(this.tokens.links[n.tag]={href:n.href,title:n.title},r.push(n));continue}if(n=this.tokenizer.table(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.lheading(e)){e=e.substring(n.raw.length),r.push(n);continue}let a=e;if(this.options.extensions?.startBlock){let i=1/0,c=e.slice(1),l;this.options.extensions.startBlock.forEach(u=>{l=u.call({lexer:this},c),typeof l=="number"&&l>=0&&(i=Math.min(i,l))}),i<1/0&&i>=0&&(a=e.substring(0,i+1))}if(this.state.top&&(n=this.tokenizer.paragraph(a))){let i=r.at(-1);o&&i?.type==="paragraph"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):r.push(n),o=a.length!==e.length,e=e.substring(n.raw.length);continue}if(n=this.tokenizer.text(e)){e=e.substring(n.raw.length);let i=r.at(-1);i?.type==="text"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):r.push(n);continue}if(e){let i="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(i);break}else throw new Error(i)}}return this.state.top=!0,r}inline(e,r=[]){return this.inlineQueue.push({src:e,tokens:r}),r}inlineTokens(e,r=[]){let o=e,n=null;if(this.tokens.links){let l=Object.keys(this.tokens.links);if(l.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)l.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)a=n[2]?n[2].length:0,o=o.slice(0,n.index+a)+"["+"a".repeat(n[0].length-a-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let i=!1,c="";for(;e;){i||(c=""),i=!1;let l;if(this.options.extensions?.inline?.some(p=>(l=p.call({lexer:this},e,r))?(e=e.substring(l.raw.length),r.push(l),!0):!1))continue;if(l=this.tokenizer.escape(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.tag(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.link(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(l.raw.length);let p=r.at(-1);l.type==="text"&&p?.type==="text"?(p.raw+=l.raw,p.text+=l.text):r.push(l);continue}if(l=this.tokenizer.emStrong(e,o,c)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.codespan(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.br(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.del(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.autolink(e)){e=e.substring(l.raw.length),r.push(l);continue}if(!this.state.inLink&&(l=this.tokenizer.url(e))){e=e.substring(l.raw.length),r.push(l);continue}let u=e;if(this.options.extensions?.startInline){let p=1/0,g=e.slice(1),f;this.options.extensions.startInline.forEach(m=>{f=m.call({lexer:this},g),typeof f=="number"&&f>=0&&(p=Math.min(p,f))}),p<1/0&&p>=0&&(u=e.substring(0,p+1))}if(l=this.tokenizer.inlineText(u)){e=e.substring(l.raw.length),l.raw.slice(-1)!=="_"&&(c=l.raw.slice(-1)),i=!0;let p=r.at(-1);p?.type==="text"?(p.raw+=l.raw,p.text+=l.text):r.push(l);continue}if(e){let p="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(p);break}else throw new Error(p)}}return r}},ht=class{options;parser;constructor(t){this.options=t||Ae}space(t){return""}code({text:t,lang:e,escaped:r}){let o=(e||"").match(q.notSpaceStart)?.[0],n=t.replace(q.endingNewline,"")+`
`;return o?'<pre><code class="language-'+me(o)+'">'+(r?n:me(n,!0))+`</code></pre>
`:"<pre><code>"+(r?n:me(n,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}def(t){return""}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){let e=t.ordered,r=t.start,o="";for(let i=0;i<t.items.length;i++){let c=t.items[i];o+=this.listitem(c)}let n=e?"ol":"ul",a=e&&r!==1?' start="'+r+'"':"";return"<"+n+a+`>
`+o+"</"+n+`>
`}listitem(t){return`<li>${this.parser.parse(t.tokens)}</li>
`}checkbox({checked:t}){return"<input "+(t?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:t}){return`<p>${this.parser.parseInline(t)}</p>
`}table(t){let e="",r="";for(let n=0;n<t.header.length;n++)r+=this.tablecell(t.header[n]);e+=this.tablerow({text:r});let o="";for(let n=0;n<t.rows.length;n++){let a=t.rows[n];r="";for(let i=0;i<a.length;i++)r+=this.tablecell(a[i]);o+=this.tablerow({text:r})}return o&&(o=`<tbody>${o}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+o+`</table>
`}tablerow({text:t}){return`<tr>
${t}</tr>
`}tablecell(t){let e=this.parser.parseInline(t.tokens),r=t.header?"th":"td";return(t.align?`<${r} align="${t.align}">`:`<${r}>`)+e+`</${r}>
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${me(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:r}){let o=this.parser.parseInline(r),n=ln(t);if(n===null)return o;t=n;let a='<a href="'+t+'"';return e&&(a+=' title="'+me(e)+'"'),a+=">"+o+"</a>",a}image({href:t,title:e,text:r,tokens:o}){o&&(r=this.parser.parseInline(o,this.parser.textRenderer));let n=ln(t);if(n===null)return me(r);t=n;let a=`<img src="${t}" alt="${r}"`;return e&&(a+=` title="${me(e)}"`),a+=">",a}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:me(t.text)}},Zt=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}checkbox({raw:t}){return t}},ae=class _r{options;renderer;textRenderer;constructor(e){this.options=e||Ae,this.options.renderer=this.options.renderer||new ht,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Zt}static parse(e,r){return new _r(r).parse(e)}static parseInline(e,r){return new _r(r).parseInline(e)}parse(e){let r="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let i=n,c=this.options.extensions.renderers[i.type].call({parser:this},i);if(c!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(i.type)){r+=c||"";continue}}let a=n;switch(a.type){case"space":{r+=this.renderer.space(a);break}case"hr":{r+=this.renderer.hr(a);break}case"heading":{r+=this.renderer.heading(a);break}case"code":{r+=this.renderer.code(a);break}case"table":{r+=this.renderer.table(a);break}case"blockquote":{r+=this.renderer.blockquote(a);break}case"list":{r+=this.renderer.list(a);break}case"checkbox":{r+=this.renderer.checkbox(a);break}case"html":{r+=this.renderer.html(a);break}case"def":{r+=this.renderer.def(a);break}case"paragraph":{r+=this.renderer.paragraph(a);break}case"text":{r+=this.renderer.text(a);break}default:{let i='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(i),"";throw new Error(i)}}}return r}parseInline(e,r=this.renderer){let o="";for(let n=0;n<e.length;n++){let a=e[n];if(this.options.extensions?.renderers?.[a.type]){let c=this.options.extensions.renderers[a.type].call({parser:this},a);if(c!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){o+=c||"";continue}}let i=a;switch(i.type){case"escape":{o+=r.text(i);break}case"html":{o+=r.html(i);break}case"link":{o+=r.link(i);break}case"image":{o+=r.image(i);break}case"checkbox":{o+=r.checkbox(i);break}case"strong":{o+=r.strong(i);break}case"em":{o+=r.em(i);break}case"codespan":{o+=r.codespan(i);break}case"br":{o+=r.br(i);break}case"del":{o+=r.del(i);break}case"text":{o+=r.text(i);break}default:{let c='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(c),"";throw new Error(c)}}}return o}},Ye=class{options;block;constructor(t){this.options=t||Ae}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}emStrongMask(t){return t}provideLexer(){return this.block?oe.lex:oe.lexInline}provideParser(){return this.block?ae.parse:ae.parseInline}},jo=class{defaults=Ft();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=ae;Renderer=ht;TextRenderer=Zt;Lexer=oe;Tokenizer=pt;Hooks=Ye;constructor(...t){this.use(...t)}walkTokens(t,e){let r=[];for(let o of t)switch(r=r.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let a of n.header)r=r.concat(this.walkTokens(a.tokens,e));for(let a of n.rows)for(let i of a)r=r.concat(this.walkTokens(i.tokens,e));break}case"list":{let n=o;r=r.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(a=>{let i=n[a].flat(1/0);r=r.concat(this.walkTokens(i,e))}):n.tokens&&(r=r.concat(this.walkTokens(n.tokens,e)))}}return r}use(...t){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(r=>{let o={...r};if(o.async=this.defaults.async||o.async||!1,r.extensions&&(r.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let a=e.renderers[n.name];a?e.renderers[n.name]=function(...i){let c=n.renderer.apply(this,i);return c===!1&&(c=a.apply(this,i)),c}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=e[n.level];a?a.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),r.renderer){let n=this.defaults.renderer||new ht(this.defaults);for(let a in r.renderer){if(!(a in n))throw new Error(`renderer '${a}' does not exist`);if(["options","parser"].includes(a))continue;let i=a,c=r.renderer[i],l=n[i];n[i]=(...u)=>{let p=c.apply(n,u);return p===!1&&(p=l.apply(n,u)),p||""}}o.renderer=n}if(r.tokenizer){let n=this.defaults.tokenizer||new pt(this.defaults);for(let a in r.tokenizer){if(!(a in n))throw new Error(`tokenizer '${a}' does not exist`);if(["options","rules","lexer"].includes(a))continue;let i=a,c=r.tokenizer[i],l=n[i];n[i]=(...u)=>{let p=c.apply(n,u);return p===!1&&(p=l.apply(n,u)),p}}o.tokenizer=n}if(r.hooks){let n=this.defaults.hooks||new Ye;for(let a in r.hooks){if(!(a in n))throw new Error(`hook '${a}' does not exist`);if(["options","block"].includes(a))continue;let i=a,c=r.hooks[i],l=n[i];Ye.passThroughHooks.has(a)?n[i]=u=>{if(this.defaults.async&&Ye.passThroughHooksRespectAsync.has(a))return(async()=>{let g=await c.call(n,u);return l.call(n,g)})();let p=c.call(n,u);return l.call(n,p)}:n[i]=(...u)=>{if(this.defaults.async)return(async()=>{let g=await c.apply(n,u);return g===!1&&(g=await l.apply(n,u)),g})();let p=c.apply(n,u);return p===!1&&(p=l.apply(n,u)),p}}o.hooks=n}if(r.walkTokens){let n=this.defaults.walkTokens,a=r.walkTokens;o.walkTokens=function(i){let c=[];return c.push(a.call(this,i)),n&&(c=c.concat(n.call(this,i))),c}}this.defaults={...this.defaults,...o}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return oe.lex(t,e??this.defaults)}parser(t,e){return ae.parse(t,e??this.defaults)}parseMarkdown(t){return(e,r)=>{let o={...r},n={...this.defaults,...o},a=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=t),n.async)return(async()=>{let i=n.hooks?await n.hooks.preprocess(e):e,c=await(n.hooks?await n.hooks.provideLexer():t?oe.lex:oe.lexInline)(i,n),l=n.hooks?await n.hooks.processAllTokens(c):c;n.walkTokens&&await Promise.all(this.walkTokens(l,n.walkTokens));let u=await(n.hooks?await n.hooks.provideParser():t?ae.parse:ae.parseInline)(l,n);return n.hooks?await n.hooks.postprocess(u):u})().catch(a);try{n.hooks&&(e=n.hooks.preprocess(e));let i=(n.hooks?n.hooks.provideLexer():t?oe.lex:oe.lexInline)(e,n);n.hooks&&(i=n.hooks.processAllTokens(i)),n.walkTokens&&this.walkTokens(i,n.walkTokens);let c=(n.hooks?n.hooks.provideParser():t?ae.parse:ae.parseInline)(i,n);return n.hooks&&(c=n.hooks.postprocess(c)),c}catch(i){return a(i)}}}onError(t,e){return r=>{if(r.message+=`
Please report this to https://github.com/markedjs/marked.`,t){let o="<p>An error occurred:</p><pre>"+me(r.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(r);throw r}}},Ee=new jo;function E(t,e){return Ee.parse(t,e)}E.options=E.setOptions=function(t){return Ee.setOptions(t),E.defaults=Ee.defaults,Yr(E.defaults),E},E.getDefaults=Ft,E.defaults=Ae,E.use=function(...t){return Ee.use(...t),E.defaults=Ee.defaults,Yr(E.defaults),E},E.walkTokens=function(t,e){return Ee.walkTokens(t,e)},E.parseInline=Ee.parseInline,E.Parser=ae,E.parser=ae.parse,E.Renderer=ht,E.TextRenderer=Zt,E.Lexer=oe,E.lexer=oe.lex,E.Tokenizer=pt,E.Hooks=Ye,E.parse=E,E.options,E.setOptions,E.use,E.walkTokens,E.parseInline,ae.parse,oe.lex;const{entries:un,setPrototypeOf:gn,isFrozen:qo,getPrototypeOf:Yo,getOwnPropertyDescriptor:Zo}=Object;let{freeze:Y,seal:re,create:Xt}=Object,{apply:Qt,construct:Vt}=typeof Reflect<"u"&&Reflect;Y||(Y=function(e){return e}),re||(re=function(e){return e}),Qt||(Qt=function(e,r){for(var o=arguments.length,n=new Array(o>2?o-2:0),a=2;a<o;a++)n[a-2]=arguments[a];return e.apply(r,n)}),Vt||(Vt=function(e){for(var r=arguments.length,o=new Array(r>1?r-1:0),n=1;n<r;n++)o[n-1]=arguments[n];return new e(...o)});const ft=X(Array.prototype.forEach),Xo=X(Array.prototype.lastIndexOf),pn=X(Array.prototype.pop),Ze=X(Array.prototype.push),Qo=X(Array.prototype.splice),mt=X(String.prototype.toLowerCase),Kt=X(String.prototype.toString),Jt=X(String.prototype.match),Xe=X(String.prototype.replace),Vo=X(String.prototype.indexOf),Ko=X(String.prototype.trim),ie=X(Object.prototype.hasOwnProperty),Z=X(RegExp.prototype.test),Qe=Jo(TypeError);function X(t){return function(e){e instanceof RegExp&&(e.lastIndex=0);for(var r=arguments.length,o=new Array(r>1?r-1:0),n=1;n<r;n++)o[n-1]=arguments[n];return Qt(t,e,o)}}function Jo(t){return function(){for(var e=arguments.length,r=new Array(e),o=0;o<e;o++)r[o]=arguments[o];return Vt(t,r)}}function w(t,e){let r=arguments.length>2&&arguments[2]!==void 0?arguments[2]:mt;gn&&gn(t,null);let o=e.length;for(;o--;){let n=e[o];if(typeof n=="string"){const a=r(n);a!==n&&(qo(e)||(e[o]=a),n=a)}t[n]=!0}return t}function ea(t){for(let e=0;e<t.length;e++)ie(t,e)||(t[e]=null);return t}function de(t){const e=Xt(null);for(const[r,o]of un(t))ie(t,r)&&(Array.isArray(o)?e[r]=ea(o):o&&typeof o=="object"&&o.constructor===Object?e[r]=de(o):e[r]=o);return e}function Ve(t,e){for(;t!==null;){const o=Zo(t,e);if(o){if(o.get)return X(o.get);if(typeof o.value=="function")return X(o.value)}t=Yo(t)}function r(){return null}return r}const hn=Y(["a","abbr","acronym","address","area","article","aside","audio","b","bdi","bdo","big","blink","blockquote","body","br","button","canvas","caption","center","cite","code","col","colgroup","content","data","datalist","dd","decorator","del","details","dfn","dialog","dir","div","dl","dt","element","em","fieldset","figcaption","figure","font","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","img","input","ins","kbd","label","legend","li","main","map","mark","marquee","menu","menuitem","meter","nav","nobr","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","search","section","select","shadow","slot","small","source","spacer","span","strike","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","tr","track","tt","u","ul","var","video","wbr"]),er=Y(["svg","a","altglyph","altglyphdef","altglyphitem","animatecolor","animatemotion","animatetransform","circle","clippath","defs","desc","ellipse","enterkeyhint","exportparts","filter","font","g","glyph","glyphref","hkern","image","inputmode","line","lineargradient","marker","mask","metadata","mpath","part","path","pattern","polygon","polyline","radialgradient","rect","stop","style","switch","symbol","text","textpath","title","tref","tspan","view","vkern"]),tr=Y(["feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feDistantLight","feDropShadow","feFlood","feFuncA","feFuncB","feFuncG","feFuncR","feGaussianBlur","feImage","feMerge","feMergeNode","feMorphology","feOffset","fePointLight","feSpecularLighting","feSpotLight","feTile","feTurbulence"]),ta=Y(["animate","color-profile","cursor","discard","font-face","font-face-format","font-face-name","font-face-src","font-face-uri","foreignobject","hatch","hatchpath","mesh","meshgradient","meshpatch","meshrow","missing-glyph","script","set","solidcolor","unknown","use"]),rr=Y(["math","menclose","merror","mfenced","mfrac","mglyph","mi","mlabeledtr","mmultiscripts","mn","mo","mover","mpadded","mphantom","mroot","mrow","ms","mspace","msqrt","mstyle","msub","msup","msubsup","mtable","mtd","mtext","mtr","munder","munderover","mprescripts"]),ra=Y(["maction","maligngroup","malignmark","mlongdiv","mscarries","mscarry","msgroup","mstack","msline","msrow","semantics","annotation","annotation-xml","mprescripts","none"]),fn=Y(["#text"]),mn=Y(["accept","action","align","alt","autocapitalize","autocomplete","autopictureinpicture","autoplay","background","bgcolor","border","capture","cellpadding","cellspacing","checked","cite","class","clear","color","cols","colspan","controls","controlslist","coords","crossorigin","datetime","decoding","default","dir","disabled","disablepictureinpicture","disableremoteplayback","download","draggable","enctype","enterkeyhint","exportparts","face","for","headers","height","hidden","high","href","hreflang","id","inert","inputmode","integrity","ismap","kind","label","lang","list","loading","loop","low","max","maxlength","media","method","min","minlength","multiple","muted","name","nonce","noshade","novalidate","nowrap","open","optimum","part","pattern","placeholder","playsinline","popover","popovertarget","popovertargetaction","poster","preload","pubdate","radiogroup","readonly","rel","required","rev","reversed","role","rows","rowspan","spellcheck","scope","selected","shape","size","sizes","slot","span","srclang","start","src","srcset","step","style","summary","tabindex","title","translate","type","usemap","valign","value","width","wrap","xmlns","slot"]),nr=Y(["accent-height","accumulate","additive","alignment-baseline","amplitude","ascent","attributename","attributetype","azimuth","basefrequency","baseline-shift","begin","bias","by","class","clip","clippathunits","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","cx","cy","d","dx","dy","diffuseconstant","direction","display","divisor","dur","edgemode","elevation","end","exponent","fill","fill-opacity","fill-rule","filter","filterunits","flood-color","flood-opacity","font-family","font-size","font-size-adjust","font-stretch","font-style","font-variant","font-weight","fx","fy","g1","g2","glyph-name","glyphref","gradientunits","gradienttransform","height","href","id","image-rendering","in","in2","intercept","k","k1","k2","k3","k4","kerning","keypoints","keysplines","keytimes","lang","lengthadjust","letter-spacing","kernelmatrix","kernelunitlength","lighting-color","local","marker-end","marker-mid","marker-start","markerheight","markerunits","markerwidth","maskcontentunits","maskunits","max","mask","mask-type","media","method","mode","min","name","numoctaves","offset","operator","opacity","order","orient","orientation","origin","overflow","paint-order","path","pathlength","patterncontentunits","patterntransform","patternunits","points","preservealpha","preserveaspectratio","primitiveunits","r","rx","ry","radius","refx","refy","repeatcount","repeatdur","restart","result","rotate","scale","seed","shape-rendering","slope","specularconstant","specularexponent","spreadmethod","startoffset","stddeviation","stitchtiles","stop-color","stop-opacity","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke","stroke-width","style","surfacescale","systemlanguage","tabindex","tablevalues","targetx","targety","transform","transform-origin","text-anchor","text-decoration","text-rendering","textlength","type","u1","u2","unicode","values","viewbox","visibility","version","vert-adv-y","vert-origin-x","vert-origin-y","width","word-spacing","wrap","writing-mode","xchannelselector","ychannelselector","x","x1","x2","xmlns","y","y1","y2","z","zoomandpan"]),bn=Y(["accent","accentunder","align","bevelled","close","columnsalign","columnlines","columnspan","denomalign","depth","dir","display","displaystyle","encoding","fence","frame","height","href","id","largeop","length","linethickness","lspace","lquote","mathbackground","mathcolor","mathsize","mathvariant","maxsize","minsize","movablelimits","notation","numalign","open","rowalign","rowlines","rowspacing","rowspan","rspace","rquote","scriptlevel","scriptminsize","scriptsizemultiplier","selection","separator","separators","stretchy","subscriptshift","supscriptshift","symmetric","voffset","width","xmlns"]),bt=Y(["xlink:href","xml:id","xlink:title","xml:space","xmlns:xlink"]),na=re(/\{\{[\w\W]*|[\w\W]*\}\}/gm),oa=re(/<%[\w\W]*|[\w\W]*%>/gm),aa=re(/\$\{[\w\W]*/gm),ia=re(/^data-[\-\w.\u00B7-\uFFFF]+$/),sa=re(/^aria-[\-\w]+$/),_n=re(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i),la=re(/^(?:\w+script|data):/i),da=re(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g),xn=re(/^html$/i),ca=re(/^[a-z][.\w]*(-[.\w]+)+$/i);var kn=Object.freeze({__proto__:null,ARIA_ATTR:sa,ATTR_WHITESPACE:da,CUSTOM_ELEMENT:ca,DATA_ATTR:ia,DOCTYPE_NAME:xn,ERB_EXPR:oa,IS_ALLOWED_URI:_n,IS_SCRIPT_OR_DATA:la,MUSTACHE_EXPR:na,TMPLIT_EXPR:aa});const Ke={element:1,text:3,progressingInstruction:7,comment:8,document:9},ua=function(){return typeof window>"u"?null:window},ga=function(e,r){if(typeof e!="object"||typeof e.createPolicy!="function")return null;let o=null;const n="data-tt-policy-suffix";r&&r.hasAttribute(n)&&(o=r.getAttribute(n));const a="dompurify"+(o?"#"+o:"");try{return e.createPolicy(a,{createHTML(i){return i},createScriptURL(i){return i}})}catch{return console.warn("TrustedTypes policy "+a+" could not be created."),null}},vn=function(){return{afterSanitizeAttributes:[],afterSanitizeElements:[],afterSanitizeShadowDOM:[],beforeSanitizeAttributes:[],beforeSanitizeElements:[],beforeSanitizeShadowDOM:[],uponSanitizeAttribute:[],uponSanitizeElement:[],uponSanitizeShadowNode:[]}};function yn(){let t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:ua();const e=x=>yn(x);if(e.version="3.3.1",e.removed=[],!t||!t.document||t.document.nodeType!==Ke.document||!t.Element)return e.isSupported=!1,e;let{document:r}=t;const o=r,n=o.currentScript,{DocumentFragment:a,HTMLTemplateElement:i,Node:c,Element:l,NodeFilter:u,NamedNodeMap:p=t.NamedNodeMap||t.MozNamedAttrMap,HTMLFormElement:g,DOMParser:f,trustedTypes:m}=t,_=l.prototype,v=Ve(_,"cloneNode"),S=Ve(_,"remove"),y=Ve(_,"nextSibling"),k=Ve(_,"childNodes"),L=Ve(_,"parentNode");if(typeof i=="function"){const x=r.createElement("template");x.content&&x.content.ownerDocument&&(r=x.content.ownerDocument)}let R,z="";const{implementation:U,createNodeIterator:ce,createDocumentFragment:se,getElementsByTagName:W}=r,{importNode:ue}=o;let C=vn();e.isSupported=typeof un=="function"&&typeof L=="function"&&U&&U.createHTMLDocument!==void 0;const{MUSTACHE_EXPR:Q,ERB_EXPR:K,TMPLIT_EXPR:le,DATA_ATTR:be,ARIA_ATTR:ne,IS_SCRIPT_OR_DATA:Ne,ATTR_WHITESPACE:ye,CUSTOM_ELEMENT:_e}=kn;let{IS_ALLOWED_URI:ge}=kn,D=null;const Re=w({},[...hn,...er,...tr,...rr,...fn]);let $=null;const I=w({},[...mn,...nr,...bn,...bt]);let T=Object.seal(Xt(null,{tagNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},allowCustomizedBuiltInElements:{writable:!0,configurable:!1,enumerable:!0,value:!1}})),ee=null,P=null;const te=Object.seal(Xt(null,{tagCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeCheck:{writable:!0,configurable:!1,enumerable:!0,value:null}}));let ir=!0,_t=!0,xt=!1,kt=!0,Me=!1,vt=!0,Ce=!1,sr=!1,lr=!1,$e=!1,yt=!1,wt=!1,Mn=!0,$n=!1;const Fa="user-content-";let dr=!0,Je=!1,ze={},pe=null;const cr=w({},["annotation-xml","audio","colgroup","desc","foreignobject","head","iframe","math","mi","mn","mo","ms","mtext","noembed","noframes","noscript","plaintext","script","style","svg","template","thead","title","video","xmp"]);let zn=null;const Dn=w({},["audio","video","img","source","image","track"]);let ur=null;const On=w({},["alt","class","for","id","label","name","pattern","placeholder","role","summary","title","value","style","xmlns"]),St="http://www.w3.org/1998/Math/MathML",Tt="http://www.w3.org/2000/svg",xe="http://www.w3.org/1999/xhtml";let De=xe,gr=!1,pr=null;const Ba=w({},[St,Tt,xe],Kt);let At=w({},["mi","mo","mn","ms","mtext"]),Et=w({},["annotation-xml"]);const Ha=w({},["title","style","font","a","script"]);let et=null;const Ua=["application/xhtml+xml","text/html"],Wa="text/html";let H=null,Oe=null;const Ga=r.createElement("form"),Pn=function(s){return s instanceof RegExp||s instanceof Function},hr=function(){let s=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};if(!(Oe&&Oe===s)){if((!s||typeof s!="object")&&(s={}),s=de(s),et=Ua.indexOf(s.PARSER_MEDIA_TYPE)===-1?Wa:s.PARSER_MEDIA_TYPE,H=et==="application/xhtml+xml"?Kt:mt,D=ie(s,"ALLOWED_TAGS")?w({},s.ALLOWED_TAGS,H):Re,$=ie(s,"ALLOWED_ATTR")?w({},s.ALLOWED_ATTR,H):I,pr=ie(s,"ALLOWED_NAMESPACES")?w({},s.ALLOWED_NAMESPACES,Kt):Ba,ur=ie(s,"ADD_URI_SAFE_ATTR")?w(de(On),s.ADD_URI_SAFE_ATTR,H):On,zn=ie(s,"ADD_DATA_URI_TAGS")?w(de(Dn),s.ADD_DATA_URI_TAGS,H):Dn,pe=ie(s,"FORBID_CONTENTS")?w({},s.FORBID_CONTENTS,H):cr,ee=ie(s,"FORBID_TAGS")?w({},s.FORBID_TAGS,H):de({}),P=ie(s,"FORBID_ATTR")?w({},s.FORBID_ATTR,H):de({}),ze=ie(s,"USE_PROFILES")?s.USE_PROFILES:!1,ir=s.ALLOW_ARIA_ATTR!==!1,_t=s.ALLOW_DATA_ATTR!==!1,xt=s.ALLOW_UNKNOWN_PROTOCOLS||!1,kt=s.ALLOW_SELF_CLOSE_IN_ATTR!==!1,Me=s.SAFE_FOR_TEMPLATES||!1,vt=s.SAFE_FOR_XML!==!1,Ce=s.WHOLE_DOCUMENT||!1,$e=s.RETURN_DOM||!1,yt=s.RETURN_DOM_FRAGMENT||!1,wt=s.RETURN_TRUSTED_TYPE||!1,lr=s.FORCE_BODY||!1,Mn=s.SANITIZE_DOM!==!1,$n=s.SANITIZE_NAMED_PROPS||!1,dr=s.KEEP_CONTENT!==!1,Je=s.IN_PLACE||!1,ge=s.ALLOWED_URI_REGEXP||_n,De=s.NAMESPACE||xe,At=s.MATHML_TEXT_INTEGRATION_POINTS||At,Et=s.HTML_INTEGRATION_POINTS||Et,T=s.CUSTOM_ELEMENT_HANDLING||{},s.CUSTOM_ELEMENT_HANDLING&&Pn(s.CUSTOM_ELEMENT_HANDLING.tagNameCheck)&&(T.tagNameCheck=s.CUSTOM_ELEMENT_HANDLING.tagNameCheck),s.CUSTOM_ELEMENT_HANDLING&&Pn(s.CUSTOM_ELEMENT_HANDLING.attributeNameCheck)&&(T.attributeNameCheck=s.CUSTOM_ELEMENT_HANDLING.attributeNameCheck),s.CUSTOM_ELEMENT_HANDLING&&typeof s.CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements=="boolean"&&(T.allowCustomizedBuiltInElements=s.CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements),Me&&(_t=!1),yt&&($e=!0),ze&&(D=w({},fn),$=[],ze.html===!0&&(w(D,hn),w($,mn)),ze.svg===!0&&(w(D,er),w($,nr),w($,bt)),ze.svgFilters===!0&&(w(D,tr),w($,nr),w($,bt)),ze.mathMl===!0&&(w(D,rr),w($,bn),w($,bt))),s.ADD_TAGS&&(typeof s.ADD_TAGS=="function"?te.tagCheck=s.ADD_TAGS:(D===Re&&(D=de(D)),w(D,s.ADD_TAGS,H))),s.ADD_ATTR&&(typeof s.ADD_ATTR=="function"?te.attributeCheck=s.ADD_ATTR:($===I&&($=de($)),w($,s.ADD_ATTR,H))),s.ADD_URI_SAFE_ATTR&&w(ur,s.ADD_URI_SAFE_ATTR,H),s.FORBID_CONTENTS&&(pe===cr&&(pe=de(pe)),w(pe,s.FORBID_CONTENTS,H)),s.ADD_FORBID_CONTENTS&&(pe===cr&&(pe=de(pe)),w(pe,s.ADD_FORBID_CONTENTS,H)),dr&&(D["#text"]=!0),Ce&&w(D,["html","head","body"]),D.table&&(w(D,["tbody"]),delete ee.tbody),s.TRUSTED_TYPES_POLICY){if(typeof s.TRUSTED_TYPES_POLICY.createHTML!="function")throw Qe('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');if(typeof s.TRUSTED_TYPES_POLICY.createScriptURL!="function")throw Qe('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');R=s.TRUSTED_TYPES_POLICY,z=R.createHTML("")}else R===void 0&&(R=ga(m,n)),R!==null&&typeof z=="string"&&(z=R.createHTML(""));Y&&Y(s),Oe=s}},Fn=w({},[...er,...tr,...ta]),Bn=w({},[...rr,...ra]),ja=function(s){let h=L(s);(!h||!h.tagName)&&(h={namespaceURI:De,tagName:"template"});const b=mt(s.tagName),M=mt(h.tagName);return pr[s.namespaceURI]?s.namespaceURI===Tt?h.namespaceURI===xe?b==="svg":h.namespaceURI===St?b==="svg"&&(M==="annotation-xml"||At[M]):!!Fn[b]:s.namespaceURI===St?h.namespaceURI===xe?b==="math":h.namespaceURI===Tt?b==="math"&&Et[M]:!!Bn[b]:s.namespaceURI===xe?h.namespaceURI===Tt&&!Et[M]||h.namespaceURI===St&&!At[M]?!1:!Bn[b]&&(Ha[b]||!Fn[b]):!!(et==="application/xhtml+xml"&&pr[s.namespaceURI]):!1},he=function(s){Ze(e.removed,{element:s});try{L(s).removeChild(s)}catch{S(s)}},Le=function(s,h){try{Ze(e.removed,{attribute:h.getAttributeNode(s),from:h})}catch{Ze(e.removed,{attribute:null,from:h})}if(h.removeAttribute(s),s==="is")if($e||yt)try{he(h)}catch{}else try{h.setAttribute(s,"")}catch{}},Hn=function(s){let h=null,b=null;if(lr)s="<remove></remove>"+s;else{const B=Jt(s,/^[\r\n\t ]+/);b=B&&B[0]}et==="application/xhtml+xml"&&De===xe&&(s='<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>'+s+"</body></html>");const M=R?R.createHTML(s):s;if(De===xe)try{h=new f().parseFromString(M,et)}catch{}if(!h||!h.documentElement){h=U.createDocument(De,"template",null);try{h.documentElement.innerHTML=gr?z:M}catch{}}const j=h.body||h.documentElement;return s&&b&&j.insertBefore(r.createTextNode(b),j.childNodes[0]||null),De===xe?W.call(h,Ce?"html":"body")[0]:Ce?h.documentElement:j},Un=function(s){return ce.call(s.ownerDocument||s,s,u.SHOW_ELEMENT|u.SHOW_COMMENT|u.SHOW_TEXT|u.SHOW_PROCESSING_INSTRUCTION|u.SHOW_CDATA_SECTION,null)},fr=function(s){return s instanceof g&&(typeof s.nodeName!="string"||typeof s.textContent!="string"||typeof s.removeChild!="function"||!(s.attributes instanceof p)||typeof s.removeAttribute!="function"||typeof s.setAttribute!="function"||typeof s.namespaceURI!="string"||typeof s.insertBefore!="function"||typeof s.hasChildNodes!="function")},Wn=function(s){return typeof c=="function"&&s instanceof c};function ke(x,s,h){ft(x,b=>{b.call(e,s,h,Oe)})}const Gn=function(s){let h=null;if(ke(C.beforeSanitizeElements,s,null),fr(s))return he(s),!0;const b=H(s.nodeName);if(ke(C.uponSanitizeElement,s,{tagName:b,allowedTags:D}),vt&&s.hasChildNodes()&&!Wn(s.firstElementChild)&&Z(/<[/\w!]/g,s.innerHTML)&&Z(/<[/\w!]/g,s.textContent)||s.nodeType===Ke.progressingInstruction||vt&&s.nodeType===Ke.comment&&Z(/<[/\w]/g,s.data))return he(s),!0;if(!(te.tagCheck instanceof Function&&te.tagCheck(b))&&(!D[b]||ee[b])){if(!ee[b]&&qn(b)&&(T.tagNameCheck instanceof RegExp&&Z(T.tagNameCheck,b)||T.tagNameCheck instanceof Function&&T.tagNameCheck(b)))return!1;if(dr&&!pe[b]){const M=L(s)||s.parentNode,j=k(s)||s.childNodes;if(j&&M){const B=j.length;for(let J=B-1;J>=0;--J){const ve=v(j[J],!0);ve.__removalCount=(s.__removalCount||0)+1,M.insertBefore(ve,y(s))}}}return he(s),!0}return s instanceof l&&!ja(s)||(b==="noscript"||b==="noembed"||b==="noframes")&&Z(/<\/no(script|embed|frames)/i,s.innerHTML)?(he(s),!0):(Me&&s.nodeType===Ke.text&&(h=s.textContent,ft([Q,K,le],M=>{h=Xe(h,M," ")}),s.textContent!==h&&(Ze(e.removed,{element:s.cloneNode()}),s.textContent=h)),ke(C.afterSanitizeElements,s,null),!1)},jn=function(s,h,b){if(Mn&&(h==="id"||h==="name")&&(b in r||b in Ga))return!1;if(!(_t&&!P[h]&&Z(be,h))){if(!(ir&&Z(ne,h))){if(!(te.attributeCheck instanceof Function&&te.attributeCheck(h,s))){if(!$[h]||P[h]){if(!(qn(s)&&(T.tagNameCheck instanceof RegExp&&Z(T.tagNameCheck,s)||T.tagNameCheck instanceof Function&&T.tagNameCheck(s))&&(T.attributeNameCheck instanceof RegExp&&Z(T.attributeNameCheck,h)||T.attributeNameCheck instanceof Function&&T.attributeNameCheck(h,s))||h==="is"&&T.allowCustomizedBuiltInElements&&(T.tagNameCheck instanceof RegExp&&Z(T.tagNameCheck,b)||T.tagNameCheck instanceof Function&&T.tagNameCheck(b))))return!1}else if(!ur[h]){if(!Z(ge,Xe(b,ye,""))){if(!((h==="src"||h==="xlink:href"||h==="href")&&s!=="script"&&Vo(b,"data:")===0&&zn[s])){if(!(xt&&!Z(Ne,Xe(b,ye,"")))){if(b)return!1}}}}}}}return!0},qn=function(s){return s!=="annotation-xml"&&Jt(s,_e)},Yn=function(s){ke(C.beforeSanitizeAttributes,s,null);const{attributes:h}=s;if(!h||fr(s))return;const b={attrName:"",attrValue:"",keepAttr:!0,allowedAttributes:$,forceKeepAttr:void 0};let M=h.length;for(;M--;){const j=h[M],{name:B,namespaceURI:J,value:ve}=j,Pe=H(B),mr=ve;let G=B==="value"?mr:Ko(mr);if(b.attrName=Pe,b.attrValue=G,b.keepAttr=!0,b.forceKeepAttr=void 0,ke(C.uponSanitizeAttribute,s,b),G=b.attrValue,$n&&(Pe==="id"||Pe==="name")&&(Le(B,s),G=Fa+G),vt&&Z(/((--!?|])>)|<\/(style|title|textarea)/i,G)){Le(B,s);continue}if(Pe==="attributename"&&Jt(G,"href")){Le(B,s);continue}if(b.forceKeepAttr)continue;if(!b.keepAttr){Le(B,s);continue}if(!kt&&Z(/\/>/i,G)){Le(B,s);continue}Me&&ft([Q,K,le],Xn=>{G=Xe(G,Xn," ")});const Zn=H(s.nodeName);if(!jn(Zn,Pe,G)){Le(B,s);continue}if(R&&typeof m=="object"&&typeof m.getAttributeType=="function"&&!J)switch(m.getAttributeType(Zn,Pe)){case"TrustedHTML":{G=R.createHTML(G);break}case"TrustedScriptURL":{G=R.createScriptURL(G);break}}if(G!==mr)try{J?s.setAttributeNS(J,B,G):s.setAttribute(B,G),fr(s)?he(s):pn(e.removed)}catch{Le(B,s)}}ke(C.afterSanitizeAttributes,s,null)},qa=function x(s){let h=null;const b=Un(s);for(ke(C.beforeSanitizeShadowDOM,s,null);h=b.nextNode();)ke(C.uponSanitizeShadowNode,h,null),Gn(h),Yn(h),h.content instanceof a&&x(h.content);ke(C.afterSanitizeShadowDOM,s,null)};return e.sanitize=function(x){let s=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},h=null,b=null,M=null,j=null;if(gr=!x,gr&&(x="<!-->"),typeof x!="string"&&!Wn(x))if(typeof x.toString=="function"){if(x=x.toString(),typeof x!="string")throw Qe("dirty is not a string, aborting")}else throw Qe("toString is not a function");if(!e.isSupported)return x;if(sr||hr(s),e.removed=[],typeof x=="string"&&(Je=!1),Je){if(x.nodeName){const ve=H(x.nodeName);if(!D[ve]||ee[ve])throw Qe("root node is forbidden and cannot be sanitized in-place")}}else if(x instanceof c)h=Hn("<!---->"),b=h.ownerDocument.importNode(x,!0),b.nodeType===Ke.element&&b.nodeName==="BODY"||b.nodeName==="HTML"?h=b:h.appendChild(b);else{if(!$e&&!Me&&!Ce&&x.indexOf("<")===-1)return R&&wt?R.createHTML(x):x;if(h=Hn(x),!h)return $e?null:wt?z:""}h&&lr&&he(h.firstChild);const B=Un(Je?x:h);for(;M=B.nextNode();)Gn(M),Yn(M),M.content instanceof a&&qa(M.content);if(Je)return x;if($e){if(yt)for(j=se.call(h.ownerDocument);h.firstChild;)j.appendChild(h.firstChild);else j=h;return($.shadowroot||$.shadowrootmode)&&(j=ue.call(o,j,!0)),j}let J=Ce?h.outerHTML:h.innerHTML;return Ce&&D["!doctype"]&&h.ownerDocument&&h.ownerDocument.doctype&&h.ownerDocument.doctype.name&&Z(xn,h.ownerDocument.doctype.name)&&(J="<!DOCTYPE "+h.ownerDocument.doctype.name+`>
`+J),Me&&ft([Q,K,le],ve=>{J=Xe(J,ve," ")}),R&&wt?R.createHTML(J):J},e.setConfig=function(){let x=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};hr(x),sr=!0},e.clearConfig=function(){Oe=null,sr=!1},e.isValidAttribute=function(x,s,h){Oe||hr({});const b=H(x),M=H(s);return jn(b,M,h)},e.addHook=function(x,s){typeof s=="function"&&Ze(C[x],s)},e.removeHook=function(x,s){if(s!==void 0){const h=Xo(C[x],s);return h===-1?void 0:Qo(C[x],h,1)[0]}return pn(C[x])},e.removeHooks=function(x){C[x]=[]},e.removeAllHooks=function(){C=vn()},e}var pa=yn();function ha({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function wn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),d("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function fa({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m5 12 7-7 7 7"}),d("path",{d:"M12 19V5"})]})}function Sn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"m6 9 6 6 6-6"})})}function Tn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function or({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),d("path",{d:"M5 3v4"}),d("path",{d:"M19 17v4"}),d("path",{d:"M3 5h4"}),d("path",{d:"M17 19h4"})]})}function ma({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"15 3 21 3 21 9"}),d("polyline",{points:"9 21 3 21 3 15"}),d("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function ba({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"4 14 10 14 10 20"}),d("polyline",{points:"20 10 14 10 14 4"}),d("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function _a({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"12",cy:"12",r:"10"}),d("path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}),d("path",{d:"M12 17h.01"})]})}function xa({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1"}),d("circle",{cx:"12",cy:"19",r:"0.5",fill:"currentColor"})]})}function ka({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})})}function va({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),d("polyline",{points:"14 2 14 8 20 8"})]})}function An({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"11",cy:"11",r:"8"}),d("path",{d:"m21 21-4.3-4.3"})]})}function En({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"}),d("path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"}),d("path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"}),d("path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375"}),d("path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5"}),d("path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396"}),d("path",{d:"M19.938 10.5a4 4 0 0 1 .585.396"}),d("path",{d:"M6 18a4 4 0 0 1-1.967-.516"}),d("path",{d:"M19.967 17.484A4 4 0 0 1 18 18"})]})}function ya({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}),d("path",{d:"m15 5 4 4"})]})}function wa({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M21 12h-8"}),d("path",{d:"M21 6H8"}),d("path",{d:"M21 18h-8"}),d("path",{d:"M3 6v4c0 1.1.9 2 2 2h3"}),d("path",{d:"M3 10v6c0 1.1.9 2 2 2h3"})]})}function Sa({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"18",cy:"18",r:"3"}),d("circle",{cx:"6",cy:"6",r:"3"}),d("path",{d:"M6 21V9a9 9 0 0 0 9 9"})]})}function Ta({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"12",cy:"12",r:"10"}),d("path",{d:"m9 12 2 2 4-4"})]})}function Aa({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("circle",{cx:"12",cy:"12",r:"10"})})}function Ea({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"12",cy:"12",r:"10"}),d("line",{x1:"12",y1:"8",x2:"12",y2:"12"}),d("line",{x1:"12",y1:"16",x2:"12.01",y2:"16"})]})}function Rn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M12 2v4"}),d("path",{d:"m16.2 7.8 2.9-2.9"}),d("path",{d:"M18 12h4"}),d("path",{d:"m16.2 16.2 2.9 2.9"}),d("path",{d:"M12 18v4"}),d("path",{d:"m4.9 19.1 2.9-2.9"}),d("path",{d:"M2 12h4"}),d("path",{d:"m4.9 4.9 2.9 2.9"})]})}E.setOptions({breaks:!0,gfm:!0});const Cn=new E.Renderer;Cn.link=({href:t,title:e,text:r})=>{const o=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${o}>${r}</a>`},E.use({renderer:Cn});function Ra(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function Ca(t){if(!t)return"";let e=t;e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\(Source:[^)]*\)/gi,""),e=e.replace(/\[\d+\]/g,"");const r=E.parse(e,{async:!1});return pa.sanitize(r,{USE_PROFILES:{html:!0},ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i})}function La({message:t}){const[e,r]=V(!1),o=t.role==="user",n=t.citations&&t.citations.length>0;return d("div",{className:`grounded-message ${t.role}`,children:[d("div",{className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:o?Ra(t.content):Ca(t.content)}}),t.isStreaming&&d("span",{className:"grounded-cursor"}),!o&&n&&d("div",{className:"grounded-sources",children:[d("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>r(!e),children:[d(Tn,{}),t.citations.length," source",t.citations.length!==1?"s":"",d(Sn,{})]}),d("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((a,i)=>{const c=a.url?.startsWith("upload://"),l=a.title||(c?"Uploaded Document":a.url)||`Source ${i+1}`;return c?d("div",{className:"grounded-source grounded-source-file",children:[d(va,{}),d("span",{className:"grounded-source-title",children:l})]},i):d("a",{href:a.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[d(Tn,{}),d("span",{className:"grounded-source-title",children:l})]},i)})})]})]})}function Ia({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return d("div",{className:"grounded-status",children:d("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return d(An,{className:"grounded-status-icon"});case"generating":return d(or,{className:"grounded-status-icon"});default:return null}})(),d("span",{className:"grounded-status-text",children:e()}),d("div",{className:"grounded-status-dots",children:[d("div",{className:"grounded-typing-dot"}),d("div",{className:"grounded-typing-dot"}),d("div",{className:"grounded-typing-dot"})]})]})})}function Na(t){switch(t){case"rewrite":return ya;case"plan":return wa;case"search":return An;case"merge":return Sa;case"generate":return or;default:return En}}function Ma(t){switch(t){case"completed":return Ta;case"in_progress":return Rn;case"error":return Ea;default:return Aa}}function Ln({steps:t,isStreaming:e=!1,defaultOpen:r=!1}){const[o,n]=V(r);if(t.length===0)return null;const a=t.filter(u=>u.status==="completed").length,i=t.length,c=t.some(u=>u.status==="in_progress"),l=()=>{if(e||c){const u=t.find(p=>p.status==="in_progress");return u?`${u.title}...`:"Processing..."}return a===i&&i>0?`Completed ${i} reasoning steps`:`${a}/${i} steps completed`};return d("div",{className:`grounded-reasoning-panel ${e?"streaming":""}`,children:[d("button",{className:`grounded-reasoning-trigger ${o?"open":""}`,onClick:()=>n(!o),type:"button",children:[d("div",{className:"grounded-reasoning-trigger-icon",children:d(En,{})}),d("span",{className:"grounded-reasoning-trigger-text",children:e||c?d("span",{className:"grounded-reasoning-shimmer",children:l()}):l()}),d(Sn,{className:"grounded-reasoning-chevron"})]}),o&&d("div",{className:"grounded-reasoning-content",children:d("div",{className:"grounded-reasoning-timeline",children:t.map((u,p)=>d($a,{step:u,isLast:p===t.length-1},u.id))})})]})}function $a({step:t,isLast:e=!1}){const r=Na(t.type),o=Ma(t.status),n=t.status==="in_progress";return t.status,t.status,d("div",{className:`grounded-reasoning-step ${t.status} ${e?"last":""}`,children:[d("div",{className:`grounded-reasoning-step-dot ${t.status}`}),d("div",{className:`grounded-reasoning-step-icon ${t.status}`,children:d(r,{})}),d("div",{className:"grounded-reasoning-step-content",children:[d("div",{className:"grounded-reasoning-step-title",children:n?d("span",{className:"grounded-reasoning-shimmer",children:t.title}):t.title}),t.summary&&d("div",{className:`grounded-reasoning-step-summary ${t.status}`,children:t.summary})]}),d("div",{className:`grounded-reasoning-step-status ${t.status}`,children:n?d(Rn,{className:"grounded-reasoning-spinner"}):d(o,{})})]})}function In({options:t,initialOpen:e=!1,onOpenChange:r}){const{token:o,apiBase:n="",position:a="bottom-right",showReasoning:i}=t,[c,l]=V(e),[u,p]=V(!1),[g,f]=V(""),m=Te(null),_=Te(null),{config:v,isLoading:S}=so({token:o,apiBase:n}),y=i??(v?.ragType==="advanced"&&v?.showReasoningSteps!==!1),{messages:k,isLoading:L,isStreaming:R,chatStatus:z,currentReasoningSteps:U,sendMessage:ce}=io({token:o,apiBase:n});Ue(()=>{m.current&&m.current.scrollIntoView({behavior:"smooth"})},[k,L,U]),Ue(()=>{c&&_.current&&setTimeout(()=>_.current?.focus(),100)},[c]);const se=Te(!1);Ue(()=>{se.current&&!L&&c&&setTimeout(()=>_.current?.focus(),50),se.current=L},[L,c]),Ue(()=>{r?.(c)},[c,r]);const W=()=>{l(!c)},ue=()=>{g.trim()&&!L&&(ce(g),f(""),_.current&&(_.current.style.height="auto"),setTimeout(()=>{_.current?.focus()},50))},C=P=>{P.key==="Enter"&&!P.shiftKey&&(P.preventDefault(),ue())},Q=P=>{const te=P.target;f(te.value),te.style.height="auto",te.style.height=Math.min(te.scrollHeight,120)+"px"},K=a==="bottom-left",le=v?.agentName||"Assistant",be=v?.welcomeMessage||"How can I help?",ne=v?.description||"Ask me anything. I'm here to assist you.",Ne=v?.logoUrl,ye=k.length===0&&!L,_e=v?.theme?.buttonStyle||"circle",ge=v?.theme?.buttonSize||"medium",D=v?.theme?.buttonText||"Chat with us",Re=v?.theme?.buttonIcon||"chat",$=v?.theme?.buttonColor||"#2563eb",I=v?.theme?.customIconUrl,T=v?.theme?.customIconSize,ee=()=>{if(I){const P=T?{"--custom-icon-size":`${T}px`}:void 0;return d("img",{src:I,alt:"",className:"grounded-launcher-custom-icon",style:P})}switch(Re){case"help":return d(_a,{});case"question":return d(xa,{});case"message":return d(ka,{});default:return d(ha,{})}};return d("div",{className:`grounded-container ${K?"left":""}`,children:[d("div",{className:`grounded-window ${c?"open":""} ${u?"expanded":""}`,children:[d("div",{className:"grounded-header",children:[d("div",{className:"grounded-header-left",children:[Ne&&d("img",{src:Ne,alt:"",className:"grounded-header-logo"}),d("h2",{className:"grounded-header-title",children:le})]}),d("div",{className:"grounded-header-actions",children:[d("button",{className:"grounded-header-btn",onClick:()=>p(!u),"aria-label":u?"Shrink chat":"Expand chat",children:u?d(ba,{}):d(ma,{})}),d("button",{className:"grounded-header-btn",onClick:W,"aria-label":"Close chat",children:d(wn,{})})]})]}),d("div",{className:"grounded-messages",children:d("div",{className:"grounded-messages-inner",children:[ye?d("div",{className:"grounded-empty",children:[d(or,{className:"grounded-empty-icon"}),d("h3",{className:"grounded-empty-title",children:ne}),d("p",{className:"grounded-empty-text",children:be})]}):d(Se,{children:[k.map((P,te)=>{const xt=te===k.length-1&&P.role==="assistant"&&y&&U.length>0,kt=P.role==="user"||P.content;return d(Se,{children:[xt&&d(Ln,{steps:U,isStreaming:L||R,defaultOpen:!1}),kt&&d(La,{message:P})]},P.id)}),y&&U.length>0&&k.length>0&&k[k.length-1].role!=="assistant"&&d(Ln,{steps:U,isStreaming:L||R,defaultOpen:!1}),(L||z.status!=="idle")&&z.status!=="streaming"&&(!y||U.length===0)&&d(Ia,{status:z})]}),d("div",{ref:m})]})}),d("div",{className:"grounded-input-area",children:d("div",{className:"grounded-input-container",children:[d("textarea",{ref:_,className:"grounded-input",placeholder:S?"Loading...":"Type a message...",value:g,onInput:Q,onKeyDown:C,rows:1,disabled:L||S}),d("button",{className:"grounded-send",onClick:ue,disabled:!g.trim()||L||S,"aria-label":"Send message",children:d(fa,{})})]})}),d("div",{className:"grounded-footer",children:["Powered by ",d("a",{href:"https://grounded.ai",target:"_blank",rel:"noopener",children:"Grounded"})]})]}),d("button",{className:`grounded-launcher grounded-launcher--${_e} grounded-launcher--${ge} ${c?"open":""}`,onClick:W,"aria-label":c?"Close chat":"Open chat",style:{backgroundColor:$},children:c?d(wn,{}):d(Se,{children:[ee(),_e==="pill"&&d("span",{className:"grounded-launcher-text",children:D})]})})]})}const za=`
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
    height: min(700px, calc(100vh - 48px));
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
    height: calc(100vh - 48px);
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
    position: relative;
    z-index: 1;
    scroll-behavior: smooth;
  }

  /* Inner wrapper for messages - separates scroll container from flex layout */
  .grounded-messages-inner {
    display: flex;
    flex-direction: column;
    gap: var(--grounded-space-md);
    min-height: 100%;
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
    padding: var(--grounded-space-sm) var(--grounded-space-md);
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
    font-size: 14px;
    line-height: 1.4;
    color: var(--grounded-text-primary);
    resize: none;
    outline: none;
    min-height: 32px;
    max-height: 100px;
    padding: 6px 4px;
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
    padding: var(--grounded-space-xs) var(--grounded-space-md);
    text-align: center;
    font-size: 10px;
    color: var(--grounded-text-tertiary);
    background: var(--grounded-bg-elevated);
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

  /* ============================================
     Full Page Chat Styles (Published Chat)
     ============================================ */

  .grounded-fullpage {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--grounded-bg-primary);
    font-family: var(--grounded-font-sans);
    -webkit-font-smoothing: antialiased;
  }

  /* Header */
  .grounded-fullpage-header {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: var(--grounded-space-md);
    padding: var(--grounded-space-md) var(--grounded-space-lg);
    background: var(--grounded-bg-primary);
    border-bottom: 1px solid var(--grounded-border);
  }

  .grounded-fullpage-logo {
    width: 36px;
    height: 36px;
    border-radius: var(--grounded-radius-sm);
    object-fit: cover;
  }

  .grounded-fullpage-avatar {
    width: 36px;
    height: 36px;
    border-radius: var(--grounded-radius-sm);
    background: var(--grounded-accent);
    color: var(--grounded-text-inverse);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
  }

  .grounded-fullpage-info h1 {
    font-size: 18px;
    font-weight: 600;
    color: var(--grounded-text-primary);
    margin: 0;
  }

  /* Messages Container */
  .grounded-fullpage-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--grounded-space-lg);
    scroll-behavior: smooth;
  }

  .grounded-fullpage-messages-inner {
    max-width: 48rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--grounded-space-lg);
  }

  /* Welcome State */
  .grounded-fullpage-welcome {
    text-align: center;
    padding: 3rem 1.5rem;
  }

  .grounded-fullpage-welcome-icon {
    width: 48px;
    height: 48px;
    margin: 0 auto 1rem;
    color: var(--grounded-text-tertiary);
  }

  .grounded-fullpage-welcome h2 {
    font-size: 18px;
    font-weight: 500;
    color: var(--grounded-text-primary);
    margin: 0 0 0.5rem;
  }

  .grounded-fullpage-welcome p {
    color: var(--grounded-text-secondary);
    font-size: 14px;
    max-width: 28rem;
    margin: 0 auto;
    line-height: 1.5;
  }

  /* Input Area */
  .grounded-fullpage-input-area {
    flex-shrink: 0;
    padding: var(--grounded-space-md) var(--grounded-space-lg);
    background: var(--grounded-bg-primary);
    border-top: 1px solid var(--grounded-border);
  }

  .grounded-fullpage-input-container {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-sm);
    max-width: 48rem;
    margin: 0 auto;
    background: var(--grounded-bg-secondary);
    border: 1px solid var(--grounded-border);
    border-radius: var(--grounded-radius-md);
    padding: var(--grounded-space-sm);
    transition: border-color var(--grounded-duration-fast), box-shadow var(--grounded-duration-fast);
  }

  .grounded-fullpage-input-container:focus-within {
    border-color: var(--grounded-accent);
    box-shadow: 0 0 0 2px var(--grounded-accent-subtle);
  }

  .grounded-fullpage-input {
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
  }

  .grounded-fullpage-input::placeholder {
    color: var(--grounded-text-tertiary);
  }

  .grounded-fullpage-send {
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
    transition: background var(--grounded-duration-fast), transform var(--grounded-duration-fast);
  }

  .grounded-fullpage-send:hover:not(:disabled) {
    background: var(--grounded-accent-hover);
  }

  .grounded-fullpage-send:active:not(:disabled) {
    transform: scale(0.95);
  }

  .grounded-fullpage-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .grounded-fullpage-send svg {
    width: 18px;
    height: 18px;
  }

  /* Footer */
  .grounded-fullpage-footer {
    flex-shrink: 0;
    padding: var(--grounded-space-sm) var(--grounded-space-lg);
    text-align: center;
    font-size: 11px;
    color: var(--grounded-text-tertiary);
    background: var(--grounded-bg-primary);
    border-top: 1px solid var(--grounded-border-subtle);
  }

  .grounded-fullpage-footer a {
    color: inherit;
    text-decoration: none;
    opacity: 0.8;
    transition: opacity var(--grounded-duration-fast);
  }

  .grounded-fullpage-footer a:hover {
    opacity: 1;
  }

  /* Mobile Responsive for Full Page */
  @media (max-width: 640px) {
    .grounded-fullpage-messages {
      padding: var(--grounded-space-md);
    }

    .grounded-fullpage-input-area {
      padding: var(--grounded-space-sm) var(--grounded-space-md);
    }
  }

  /* ============================================
     Reasoning Panel Styles (Advanced RAG)
     ============================================ */

  .grounded-reasoning-panel {
    margin-bottom: var(--grounded-space-md);
    background: var(--grounded-bg-secondary);
    border: 1px solid var(--grounded-border);
    border-radius: var(--grounded-radius-md);
    overflow: hidden;
    animation: grounded-fade-in var(--grounded-duration-normal) var(--grounded-ease-out);
  }

  .grounded-reasoning-panel.streaming {
    border-color: var(--grounded-accent);
    box-shadow: 0 0 0 1px var(--grounded-accent-subtle);
  }

  /* Reasoning Panel Trigger/Header */
  .grounded-reasoning-trigger {
    display: flex;
    align-items: center;
    gap: var(--grounded-space-sm);
    width: 100%;
    padding: var(--grounded-space-sm) var(--grounded-space-md);
    background: transparent;
    border: none;
    font-family: var(--grounded-font-sans);
    font-size: 13px;
    font-weight: 500;
    color: var(--grounded-text-secondary);
    cursor: pointer;
    transition: all var(--grounded-duration-fast);
    text-align: left;
  }

  .grounded-reasoning-trigger:hover {
    background: var(--grounded-bg-tertiary);
    color: var(--grounded-text-primary);
  }

  .grounded-reasoning-trigger-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--grounded-radius-sm);
    background: var(--grounded-accent-subtle);
    color: var(--grounded-accent);
    flex-shrink: 0;
  }

  .grounded-reasoning-trigger-icon svg {
    width: 14px;
    height: 14px;
  }

  .grounded-reasoning-trigger-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .grounded-reasoning-chevron {
    width: 16px;
    height: 16px;
    color: var(--grounded-text-tertiary);
    transition: transform var(--grounded-duration-fast);
    flex-shrink: 0;
  }

  .grounded-reasoning-trigger.open .grounded-reasoning-chevron {
    transform: rotate(180deg);
  }

  /* Reasoning Panel Content */
  .grounded-reasoning-content {
    padding: var(--grounded-space-sm) var(--grounded-space-md) var(--grounded-space-md);
    border-top: 1px solid var(--grounded-border-subtle);
    animation: grounded-fade-in var(--grounded-duration-fast) var(--grounded-ease-out);
  }

  /* Reasoning Timeline */
  .grounded-reasoning-timeline {
    position: relative;
    padding-left: var(--grounded-space-md);
    margin-left: 3px;
    border-left: 2px solid var(--grounded-border);
  }

  .grounded-reasoning-panel.streaming .grounded-reasoning-timeline {
    border-left-color: var(--grounded-accent);
  }

  /* Constrain reasoning panel width to match assistant messages */
  .grounded-messages-inner .grounded-reasoning-panel,
  .grounded-fullpage-messages-inner .grounded-reasoning-panel {
    max-width: 85%;
    align-self: flex-start;
  }

  /* Reasoning Step Item */
  .grounded-reasoning-step {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: var(--grounded-space-sm);
    padding: var(--grounded-space-xs) 0;
  }

  .grounded-reasoning-step.last {
    padding-bottom: 0;
  }

  /* Timeline Dot */
  .grounded-reasoning-step-dot {
    position: absolute;
    left: calc(-1 * var(--grounded-space-md) - 5px);
    top: 10px;
    width: 8px;
    height: 8px;
    border-radius: var(--grounded-radius-full);
    border: 2px solid var(--grounded-bg-secondary);
    background: var(--grounded-text-tertiary);
  }

  .grounded-reasoning-step-dot.completed {
    background: #22c55e;
  }

  .grounded-reasoning-step-dot.in_progress {
    background: var(--grounded-accent);
    animation: grounded-pulse 2s ease-in-out infinite;
  }

  .grounded-reasoning-step-dot.pending {
    background: var(--grounded-border);
  }

  .grounded-reasoning-step-dot.error {
    background: #ef4444;
  }

  /* Step Icon */
  .grounded-reasoning-step-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--grounded-radius-sm);
    background: var(--grounded-bg-tertiary);
    color: var(--grounded-text-tertiary);
    flex-shrink: 0;
    transition: all var(--grounded-duration-fast);
  }

  .grounded-reasoning-step-icon svg {
    width: 14px;
    height: 14px;
  }

  .grounded-reasoning-step-icon.completed {
    background: rgba(34, 197, 94, 0.1);
    color: #22c55e;
  }

  .grounded-reasoning-step-icon.in_progress {
    background: var(--grounded-accent-subtle);
    color: var(--grounded-accent);
  }

  .grounded-reasoning-step-icon.pending {
    background: var(--grounded-bg-tertiary);
    color: var(--grounded-text-tertiary);
  }

  .grounded-reasoning-step-icon.error {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }

  /* Step Content */
  .grounded-reasoning-step-content {
    flex: 1;
    min-width: 0;
    padding-top: 4px;
  }

  .grounded-reasoning-step-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--grounded-text-primary);
    line-height: 1.3;
  }

  .grounded-reasoning-step.pending .grounded-reasoning-step-title {
    color: var(--grounded-text-tertiary);
  }

  .grounded-reasoning-step.completed .grounded-reasoning-step-title {
    color: var(--grounded-text-secondary);
  }

  .grounded-reasoning-step.error .grounded-reasoning-step-title {
    color: #ef4444;
  }

  .grounded-reasoning-step-summary {
    font-size: 12px;
    color: var(--grounded-text-tertiary);
    line-height: 1.4;
    margin-top: 2px;
  }

  .grounded-reasoning-step-summary.completed {
    color: var(--grounded-text-tertiary);
  }

  .grounded-reasoning-step-summary.error {
    color: rgba(239, 68, 68, 0.8);
  }

  /* Step Status Icon */
  .grounded-reasoning-step-status {
    flex-shrink: 0;
    margin-top: 6px;
  }

  .grounded-reasoning-step-status svg {
    width: 14px;
    height: 14px;
  }

  .grounded-reasoning-step-status.completed {
    color: #22c55e;
  }

  .grounded-reasoning-step-status.in_progress {
    color: var(--grounded-accent);
  }

  .grounded-reasoning-step-status.pending {
    color: var(--grounded-text-tertiary);
  }

  .grounded-reasoning-step-status.error {
    color: #ef4444;
  }

  /* Shimmer Animation for In-Progress Text */
  .grounded-reasoning-shimmer {
    background: linear-gradient(
      90deg,
      var(--grounded-text-primary) 0%,
      var(--grounded-text-tertiary) 50%,
      var(--grounded-text-primary) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: grounded-shimmer 1.5s ease-in-out infinite;
  }

  @keyframes grounded-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* Spinner Animation for Loader Icon */
  .grounded-reasoning-spinner {
    animation: grounded-spin 1s linear infinite;
  }
`;function Da(t){const{containerId:e,containerStyle:r="",colorScheme:o="auto"}=t,n=document.createElement("div");n.id=e,r&&(n.style.cssText=r),document.body.appendChild(n);const a=n.attachShadow({mode:"open"}),i=document.createElement("style");i.textContent=za,a.appendChild(i),Oa(n,o);let c=null,l=null;o==="auto"&&(c=window.matchMedia("(prefers-color-scheme: dark)"),l=()=>{console.log("[Grounded] System theme changed")},c.addEventListener("change",l));const u=document.createElement("div");return u.style.cssText="height:100%;width:100%;",a.appendChild(u),{container:n,shadowRoot:a,mountPoint:u,cleanup:()=>{c&&l&&c.removeEventListener("change",l),n.remove()}}}function Oa(t,e){t.classList.remove("light","dark"),e==="light"?t.classList.add("light"):e==="dark"&&t.classList.add("dark")}class Pa{constructor(){this.context=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.processQueue()}processQueue(){const e=window.grounded?.q||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,r){switch(e){case"init":this.init(r);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[Grounded Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[Grounded Widget] Already initialized");return}if(!e?.token){console.error("[Grounded Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase(),colorScheme:e.colorScheme||"auto"},this.context=Da({containerId:"grounded-widget-root",colorScheme:this.options.colorScheme}),$r(d(In,{options:this.options,initialOpen:this.openState,onOpenChange:r=>{this.openState=r,this.openCallback?.(r)}}),this.context.mountPoint),this.isInitialized=!0,console.log("[Grounded Widget] Initialized with colorScheme:",this.options.colorScheme)}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const r of e){const o=r.getAttribute("src");if(o)try{return new URL(o,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){!this.context||!this.options||$r(d(In,{options:this.options,initialOpen:this.openState,onOpenChange:e=>{this.openState=e,this.openCallback?.(e)}}),this.context.mountPoint)}destroy(){this.context&&(this.context.cleanup(),this.context=null),this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[Grounded Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const ar=new Pa;function Nn(t,e){ar.handleCommand(t,e)}return window.grounded=Nn,window.GroundedWidget=ar,tt.GroundedWidget=ar,tt.grounded=Nn,Object.defineProperty(tt,Symbol.toStringTag,{value:"Module"}),tt})({});
