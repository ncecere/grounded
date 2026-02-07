var GroundedChat=(function(yt){"use strict";var Je,L,mr,be,_r,br,xr,kr,wt,Tt,St,Pe={},vr=[],Yn=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,et=Array.isArray;function ce(t,e){for(var r in e)t[r]=e[r];return t}function At(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function Zn(t,e,r){var o,n,a,i={};for(a in e)a=="key"?o=e[a]:a=="ref"?n=e[a]:i[a]=e[a];if(arguments.length>2&&(i.children=arguments.length>3?Je.call(arguments,2):r),typeof t=="function"&&t.defaultProps!=null)for(a in t.defaultProps)i[a]===void 0&&(i[a]=t.defaultProps[a]);return tt(t,i,o,n,null)}function tt(t,e,r,o,n){var a={type:t,props:e,key:r,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++mr,__i:-1,__u:0};return n==null&&L.vnode!=null&&L.vnode(a),a}function Ae(t){return t.children}function rt(t,e){this.props=t,this.context=e}function Ee(t,e){if(e==null)return t.__?Ee(t.__,t.__i+1):null;for(var r;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null)return r.__e;return typeof t.type=="function"?Ee(t):null}function yr(t){var e,r;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null){t.__e=t.__c.base=r.__e;break}return yr(t)}}function wr(t){(!t.__d&&(t.__d=!0)&&be.push(t)&&!nt.__r++||_r!=L.debounceRendering)&&((_r=L.debounceRendering)||br)(nt)}function nt(){for(var t,e,r,o,n,a,i,d=1;be.length;)be.length>d&&be.sort(xr),t=be.shift(),d=be.length,t.__d&&(r=void 0,o=void 0,n=(o=(e=t).__v).__e,a=[],i=[],e.__P&&((r=ce({},o)).__v=o.__v+1,L.vnode&&L.vnode(r),Et(e.__P,r,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,a,n??Ee(o),!!(32&o.__u),i),r.__v=o.__v,r.__.__k[r.__i]=r,Rr(a,r,i),o.__e=o.__=null,r.__e!=n&&yr(r)));nt.__r=0}function Tr(t,e,r,o,n,a,i,d,l,u,p){var c,f,m,_,T,w,k,v=o&&o.__k||vr,z=e.length;for(l=Xn(r,e,v,l,z),c=0;c<z;c++)(m=r.__k[c])!=null&&(f=m.__i==-1?Pe:v[m.__i]||Pe,m.__i=c,w=Et(t,m,f,n,a,i,d,l,u,p),_=m.__e,m.ref&&f.ref!=m.ref&&(f.ref&&Ct(f.ref,null,m),p.push(m.ref,m.__c||_,m)),T==null&&_!=null&&(T=_),(k=!!(4&m.__u))||f.__k===m.__k?l=Sr(m,l,t,k):typeof m.type=="function"&&w!==void 0?l=w:_&&(l=_.nextSibling),m.__u&=-7);return r.__e=T,l}function Xn(t,e,r,o,n){var a,i,d,l,u,p=r.length,c=p,f=0;for(t.__k=new Array(n),a=0;a<n;a++)(i=e[a])!=null&&typeof i!="boolean"&&typeof i!="function"?(typeof i=="string"||typeof i=="number"||typeof i=="bigint"||i.constructor==String?i=t.__k[a]=tt(null,i,null,null,null):et(i)?i=t.__k[a]=tt(Ae,{children:i},null,null,null):i.constructor===void 0&&i.__b>0?i=t.__k[a]=tt(i.type,i.props,i.key,i.ref?i.ref:null,i.__v):t.__k[a]=i,l=a+f,i.__=t,i.__b=t.__b+1,d=null,(u=i.__i=Vn(i,r,l,c))!=-1&&(c--,(d=r[u])&&(d.__u|=2)),d==null||d.__v==null?(u==-1&&(n>p?f--:n<p&&f++),typeof i.type!="function"&&(i.__u|=4)):u!=l&&(u==l-1?f--:u==l+1?f++:(u>l?f--:f++,i.__u|=4))):t.__k[a]=null;if(c)for(a=0;a<p;a++)(d=r[a])!=null&&(2&d.__u)==0&&(d.__e==o&&(o=Ee(d)),Lr(d,d));return o}function Sr(t,e,r,o){var n,a;if(typeof t.type=="function"){for(n=t.__k,a=0;n&&a<n.length;a++)n[a]&&(n[a].__=t,e=Sr(n[a],e,r,o));return e}t.__e!=e&&(o&&(e&&t.type&&!e.parentNode&&(e=Ee(t)),r.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function Vn(t,e,r,o){var n,a,i,d=t.key,l=t.type,u=e[r],p=u!=null&&(2&u.__u)==0;if(u===null&&d==null||p&&d==u.key&&l==u.type)return r;if(o>(p?1:0)){for(n=r-1,a=r+1;n>=0||a<e.length;)if((u=e[i=n>=0?n--:a++])!=null&&(2&u.__u)==0&&d==u.key&&l==u.type)return i}return-1}function Ar(t,e,r){e[0]=="-"?t.setProperty(e,r??""):t[e]=r==null?"":typeof r!="number"||Yn.test(e)?r:r+"px"}function ot(t,e,r,o,n){var a,i;e:if(e=="style")if(typeof r=="string")t.style.cssText=r;else{if(typeof o=="string"&&(t.style.cssText=o=""),o)for(e in o)r&&e in r||Ar(t.style,e,"");if(r)for(e in r)o&&r[e]==o[e]||Ar(t.style,e,r[e])}else if(e[0]=="o"&&e[1]=="n")a=e!=(e=e.replace(kr,"$1")),i=e.toLowerCase(),e=i in t||e=="onFocusOut"||e=="onFocusIn"?i.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+a]=r,r?o?r.u=o.u:(r.u=wt,t.addEventListener(e,a?St:Tt,a)):t.removeEventListener(e,a?St:Tt,a);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&r==1?"":r))}}function Er(t){return function(e){if(this.l){var r=this.l[e.type+t];if(e.t==null)e.t=wt++;else if(e.t<r.u)return;return r(L.event?L.event(e):e)}}}function Et(t,e,r,o,n,a,i,d,l,u){var p,c,f,m,_,T,w,k,v,z,E,O,K,ie,se,I,Z,C=e.type;if(e.constructor!==void 0)return null;128&r.__u&&(l=!!(32&r.__u),a=[d=e.__e=r.__e]),(p=L.__b)&&p(e);e:if(typeof C=="function")try{if(k=e.props,v="prototype"in C&&C.prototype.render,z=(p=C.contextType)&&o[p.__c],E=p?z?z.props.value:p.__:o,r.__c?w=(c=e.__c=r.__c).__=c.__E:(v?e.__c=c=new C(k,E):(e.__c=c=new rt(k,E),c.constructor=C,c.render=Kn),z&&z.sub(c),c.state||(c.state={}),c.__n=o,f=c.__d=!0,c.__h=[],c._sb=[]),v&&c.__s==null&&(c.__s=c.state),v&&C.getDerivedStateFromProps!=null&&(c.__s==c.state&&(c.__s=ce({},c.__s)),ce(c.__s,C.getDerivedStateFromProps(k,c.__s))),m=c.props,_=c.state,c.__v=e,f)v&&C.getDerivedStateFromProps==null&&c.componentWillMount!=null&&c.componentWillMount(),v&&c.componentDidMount!=null&&c.__h.push(c.componentDidMount);else{if(v&&C.getDerivedStateFromProps==null&&k!==m&&c.componentWillReceiveProps!=null&&c.componentWillReceiveProps(k,E),e.__v==r.__v||!c.__e&&c.shouldComponentUpdate!=null&&c.shouldComponentUpdate(k,c.__s,E)===!1){for(e.__v!=r.__v&&(c.props=k,c.state=c.__s,c.__d=!1),e.__e=r.__e,e.__k=r.__k,e.__k.some(function(X){X&&(X.__=e)}),O=0;O<c._sb.length;O++)c.__h.push(c._sb[O]);c._sb=[],c.__h.length&&i.push(c);break e}c.componentWillUpdate!=null&&c.componentWillUpdate(k,c.__s,E),v&&c.componentDidUpdate!=null&&c.__h.push(function(){c.componentDidUpdate(m,_,T)})}if(c.context=E,c.props=k,c.__P=t,c.__e=!1,K=L.__r,ie=0,v){for(c.state=c.__s,c.__d=!1,K&&K(e),p=c.render(c.props,c.state,c.context),se=0;se<c._sb.length;se++)c.__h.push(c._sb[se]);c._sb=[]}else do c.__d=!1,K&&K(e),p=c.render(c.props,c.state,c.context),c.state=c.__s;while(c.__d&&++ie<25);c.state=c.__s,c.getChildContext!=null&&(o=ce(ce({},o),c.getChildContext())),v&&!f&&c.getSnapshotBeforeUpdate!=null&&(T=c.getSnapshotBeforeUpdate(m,_)),I=p,p!=null&&p.type===Ae&&p.key==null&&(I=Cr(p.props.children)),d=Tr(t,et(I)?I:[I],e,r,o,n,a,i,d,l,u),c.base=e.__e,e.__u&=-161,c.__h.length&&i.push(c),w&&(c.__E=c.__=null)}catch(X){if(e.__v=null,l||a!=null)if(X.then){for(e.__u|=l?160:128;d&&d.nodeType==8&&d.nextSibling;)d=d.nextSibling;a[a.indexOf(d)]=null,e.__e=d}else{for(Z=a.length;Z--;)At(a[Z]);Rt(e)}else e.__e=r.__e,e.__k=r.__k,X.then||Rt(e);L.__e(X,e,r)}else a==null&&e.__v==r.__v?(e.__k=r.__k,e.__e=r.__e):d=e.__e=Qn(r.__e,e,r,o,n,a,i,l,u);return(p=L.diffed)&&p(e),128&e.__u?void 0:d}function Rt(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Rt)}function Rr(t,e,r){for(var o=0;o<r.length;o++)Ct(r[o],r[++o],r[++o]);L.__c&&L.__c(e,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(a){a.call(n)})}catch(a){L.__e(a,n.__v)}})}function Cr(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:et(t)?t.map(Cr):ce({},t)}function Qn(t,e,r,o,n,a,i,d,l){var u,p,c,f,m,_,T,w=r.props||Pe,k=e.props,v=e.type;if(v=="svg"?n="http://www.w3.org/2000/svg":v=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),a!=null){for(u=0;u<a.length;u++)if((m=a[u])&&"setAttribute"in m==!!v&&(v?m.localName==v:m.nodeType==3)){t=m,a[u]=null;break}}if(t==null){if(v==null)return document.createTextNode(k);t=document.createElementNS(n,v,k.is&&k),d&&(L.__m&&L.__m(e,a),d=!1),a=null}if(v==null)w===k||d&&t.data==k||(t.data=k);else{if(a=a&&Je.call(t.childNodes),!d&&a!=null)for(w={},u=0;u<t.attributes.length;u++)w[(m=t.attributes[u]).name]=m.value;for(u in w)if(m=w[u],u!="children"){if(u=="dangerouslySetInnerHTML")c=m;else if(!(u in k)){if(u=="value"&&"defaultValue"in k||u=="checked"&&"defaultChecked"in k)continue;ot(t,u,null,m,n)}}for(u in k)m=k[u],u=="children"?f=m:u=="dangerouslySetInnerHTML"?p=m:u=="value"?_=m:u=="checked"?T=m:d&&typeof m!="function"||w[u]===m||ot(t,u,m,w[u],n);if(p)d||c&&(p.__html==c.__html||p.__html==t.innerHTML)||(t.innerHTML=p.__html),e.__k=[];else if(c&&(t.innerHTML=""),Tr(e.type=="template"?t.content:t,et(f)?f:[f],e,r,o,v=="foreignObject"?"http://www.w3.org/1999/xhtml":n,a,i,a?a[0]:r.__k&&Ee(r,0),d,l),a!=null)for(u=a.length;u--;)At(a[u]);d||(u="value",v=="progress"&&_==null?t.removeAttribute("value"):_!=null&&(_!==t[u]||v=="progress"&&!_||v=="option"&&_!=w[u])&&ot(t,u,_,w[u],n),u="checked",T!=null&&T!=t[u]&&ot(t,u,T,w[u],n))}return t}function Ct(t,e,r){try{if(typeof t=="function"){var o=typeof t.__u=="function";o&&t.__u(),o&&e==null||(t.__u=t(e))}else t.current=e}catch(n){L.__e(n,r)}}function Lr(t,e,r){var o,n;if(L.unmount&&L.unmount(t),(o=t.ref)&&(o.current&&o.current!=t.__e||Ct(o,null,e)),(o=t.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(a){L.__e(a,e)}o.base=o.__P=null}if(o=t.__k)for(n=0;n<o.length;n++)o[n]&&Lr(o[n],e,r||typeof t.type!="function");r||At(t.__e),t.__c=t.__=t.__e=void 0}function Kn(t,e,r){return this.constructor(t,r)}function Jn(t,e,r){var o,n,a,i;e==document&&(e=document.documentElement),L.__&&L.__(t,e),n=(o=!1)?null:e.__k,a=[],i=[],Et(e,t=e.__k=Zn(Ae,null,[t]),n||Pe,Pe,e.namespaceURI,n?null:e.firstChild?Je.call(e.childNodes):null,a,n?n.__e:e.firstChild,o,i),Rr(a,t,i)}Je=vr.slice,L={__e:function(t,e,r,o){for(var n,a,i;e=e.__;)if((n=e.__c)&&!n.__)try{if((a=n.constructor)&&a.getDerivedStateFromError!=null&&(n.setState(a.getDerivedStateFromError(t)),i=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(t,o||{}),i=n.__d),i)return n.__E=n}catch(d){t=d}throw t}},mr=0,rt.prototype.setState=function(t,e){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=ce({},this.state),typeof t=="function"&&(t=t(ce({},r),this.props)),t&&ce(r,t),t!=null&&this.__v&&(e&&this._sb.push(e),wr(this))},rt.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),wr(this))},rt.prototype.render=Ae,be=[],br=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,xr=function(t,e){return t.__v.__b-e.__v.__b},nt.__r=0,kr=/(PointerCapture)$|Capture$/i,wt=0,Tt=Er(!1),St=Er(!0);var eo=0;function g(t,e,r,o,n,a){e||(e={});var i,d,l=e;if("ref"in l)for(d in l={},e)d=="ref"?i=e[d]:l[d]=e[d];var u={type:t,props:l,key:r,ref:i,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--eo,__i:-1,__u:0,__source:n,__self:a};if(typeof t=="function"&&(i=t.defaultProps))for(d in i)l[d]===void 0&&(l[d]=i[d]);return L.vnode&&L.vnode(u),u}var Oe,$,Lt,Ir,Fe=0,Nr=[],P=L,Mr=P.__b,$r=P.__r,zr=P.diffed,Dr=P.__c,Pr=P.unmount,Or=P.__;function It(t,e){P.__h&&P.__h($,t,Fe||e),Fe=0;var r=$.__H||($.__H={__:[],__h:[]});return t>=r.__.length&&r.__.push({}),r.__[t]}function ge(t){return Fe=1,to(Ur,t)}function to(t,e,r){var o=It(Oe++,2);if(o.t=t,!o.__c&&(o.__=[Ur(void 0,e),function(d){var l=o.__N?o.__N[0]:o.__[0],u=o.t(l,d);l!==u&&(o.__N=[u,o.__[1]],o.__c.setState({}))}],o.__c=$,!$.__f)){var n=function(d,l,u){if(!o.__c.__H)return!0;var p=o.__c.__H.__.filter(function(f){return!!f.__c});if(p.every(function(f){return!f.__N}))return!a||a.call(this,d,l,u);var c=o.__c.props!==d;return p.forEach(function(f){if(f.__N){var m=f.__[0];f.__=f.__N,f.__N=void 0,m!==f.__[0]&&(c=!0)}}),a&&a.call(this,d,l,u)||c};$.__f=!0;var a=$.shouldComponentUpdate,i=$.componentWillUpdate;$.componentWillUpdate=function(d,l,u){if(this.__e){var p=a;a=void 0,n(d,l,u),a=p}i&&i.call(this,d,l,u)},$.shouldComponentUpdate=n}return o.__N||o.__}function Nt(t,e){var r=It(Oe++,3);!P.__s&&Hr(r.__H,e)&&(r.__=t,r.u=e,$.__H.__h.push(r))}function xe(t){return Fe=5,Fr(function(){return{current:t}},[])}function Fr(t,e){var r=It(Oe++,7);return Hr(r.__H,e)&&(r.__=t(),r.__H=e,r.__h=t),r.__}function Mt(t,e){return Fe=8,Fr(function(){return t},e)}function ro(){for(var t;t=Nr.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(at),t.__H.__h.forEach($t),t.__H.__h=[]}catch(e){t.__H.__h=[],P.__e(e,t.__v)}}P.__b=function(t){$=null,Mr&&Mr(t)},P.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),Or&&Or(t,e)},P.__r=function(t){$r&&$r(t),Oe=0;var e=($=t.__c).__H;e&&(Lt===$?(e.__h=[],$.__h=[],e.__.forEach(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(e.__h.forEach(at),e.__h.forEach($t),e.__h=[],Oe=0)),Lt=$},P.diffed=function(t){zr&&zr(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(Nr.push(e)!==1&&Ir===P.requestAnimationFrame||((Ir=P.requestAnimationFrame)||no)(ro)),e.__H.__.forEach(function(r){r.u&&(r.__H=r.u),r.u=void 0})),Lt=$=null},P.__c=function(t,e){e.some(function(r){try{r.__h.forEach(at),r.__h=r.__h.filter(function(o){return!o.__||$t(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],P.__e(o,r.__v)}}),Dr&&Dr(t,e)},P.unmount=function(t){Pr&&Pr(t);var e,r=t.__c;r&&r.__H&&(r.__H.__.forEach(function(o){try{at(o)}catch(n){e=n}}),r.__H=void 0,e&&P.__e(e,r.__v))};var Br=typeof requestAnimationFrame=="function";function no(t){var e,r=function(){clearTimeout(o),Br&&cancelAnimationFrame(e),setTimeout(t)},o=setTimeout(r,35);Br&&(e=requestAnimationFrame(r))}function at(t){var e=$,r=t.__c;typeof r=="function"&&(t.__c=void 0,r()),$=e}function $t(t){var e=$;t.__c=t.__(),$=e}function Hr(t,e){return!t||t.length!==e.length||e.some(function(r,o){return r!==t[o]})}function Ur(t,e){return typeof e=="function"?e(t):e}function oo({token:t,apiBase:e,endpointType:r="widget"}){const[o,n]=ge([]),[a,i]=ge(!1),[d,l]=ge(!1),[u,p]=ge(null),[c,f]=ge({status:"idle"}),[m,_]=ge([]),T=xe(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),w=xe(null),k=xe(null),v=xe(new Map),z=()=>Math.random().toString(36).slice(2,11),E=Mt(async ie=>{if(!ie.trim()||a||d)return;const se={id:z(),role:"user",content:ie.trim(),timestamp:Date.now()},I=z();n(V=>[...V,se]),i(!0),l(!0),p(null),f({status:"searching",message:"Searching knowledge base..."}),_([]),k.current=null,v.current.clear(),w.current=new AbortController;const Z=6e4;let C;const X=()=>{clearTimeout(C),C=setTimeout(()=>w.current?.abort(),Z)};try{const V={message:ie.trim()};T.current&&(V.conversationId=T.current);const ne=r==="chat-endpoint"?`${e}/api/v1/c/${t}/chat/stream`:`${e}/api/v1/widget/${t}/chat/stream`;X();const ye=await fetch(ne,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(V),signal:w.current.signal});if(!ye.ok){const _e=await ye.json().catch(()=>({}));throw new Error(_e.message||`Request failed: ${ye.status}`)}n(_e=>[..._e,{id:I,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),i(!1);const le=ye.body?.getReader();if(!le)throw new Error("No response body");const rr=new TextDecoder;let Re="",Ce="";for(;;){X();const{done:_e,value:F}=await le.read();if(_e)break;Re+=rr.decode(F,{stream:!0});const Ve=Re.split(`
`);Re=Ve.pop()||"";for(const D of Ve)if(D.startsWith("data: "))try{const N=JSON.parse(D.slice(6));if(N.type==="status"){const R=N.status==="searching"?"searching":N.status==="generating"?"generating":"searching";f({status:R,message:N.message,sourcesCount:N.sourcesCount})}else if(N.type==="sources"&&N.sources)k.current=N.sources.map(R=>({index:R.index,title:R.title,url:R.url,snippet:R.snippet}));else if(N.type==="reasoning"&&N.step)v.current.set(N.step.id,N.step),_(Array.from(v.current.values()));else if(N.type==="text"&&N.content)Ce||f({status:"streaming"}),Ce+=N.content,n(R=>R.map(oe=>oe.id===I?{...oe,content:Ce}:oe));else if(N.type==="done"){if(N.conversationId){T.current=N.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,N.conversationId)}catch{}}const R=k.current?[...k.current]:[];k.current=null,v.current.clear(),n(oe=>oe.map(we=>we.id===I?{...we,content:Ce,isStreaming:!1,citations:R}:we)),f({status:"idle"})}else if(N.type==="error")throw new Error(N.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",D)}}}catch(V){if(v.current.clear(),_([]),V.name==="AbortError"){f({status:"idle"}),w.current&&p("Connection timed out. Please try again.");return}f({status:"idle"}),p(V instanceof Error?V.message:"An error occurred"),n(ne=>ne.some(le=>le.id===I)?ne.map(le=>le.id===I?{...le,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:le):[...ne,{id:I,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{clearTimeout(C),i(!1),l(!1),w.current=null}},[t,e,a,d]),O=Mt(()=>{w.current&&(w.current.abort(),w.current=null),l(!1),i(!1)},[]),K=Mt(()=>{n([]),T.current=null,v.current.clear(),_([]);try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:o,isLoading:a,isStreaming:d,error:u,chatStatus:c,currentReasoningSteps:m,sendMessage:E,stopStreaming:O,clearMessages:K}}function zt(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var ke=zt();function Wr(t){ke=t}var Be={exec:()=>null};function S(t,e=""){let r=typeof t=="string"?t:t.source,o={replace:(n,a)=>{let i=typeof a=="string"?a:a.source;return i=i.replace(G.caret,"$1"),r=r.replace(n,i),o},getRegex:()=>new RegExp(r,e)};return o}var ao=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),G={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},io=/^(?:[ \t]*(?:\n|$))+/,so=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,lo=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,He=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,uo=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Dt=/(?:[*+-]|\d{1,9}[.)])/,Gr=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,jr=S(Gr).replace(/bull/g,Dt).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),co=S(Gr).replace(/bull/g,Dt).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Pt=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,go=/^[^\n]+/,Ot=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,po=S(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",Ot).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),ho=S(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Dt).getRegex(),it="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Ft=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,fo=S("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",Ft).replace("tag",it).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),qr=S(Pt).replace("hr",He).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",it).getRegex(),mo=S(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",qr).getRegex(),Bt={blockquote:mo,code:so,def:po,fences:lo,heading:uo,hr:He,html:fo,lheading:jr,list:ho,newline:io,paragraph:qr,table:Be,text:go},Yr=S("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",He).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",it).getRegex(),_o={...Bt,lheading:co,table:Yr,paragraph:S(Pt).replace("hr",He).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Yr).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",it).getRegex()},bo={...Bt,html:S(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",Ft).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:Be,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:S(Pt).replace("hr",He).replace("heading",` *#{1,6} *[^
]`).replace("lheading",jr).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},xo=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,ko=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,Zr=/^( {2,}|\\)\n(?!\s*$)/,vo=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,st=/[\p{P}\p{S}]/u,Ht=/[\s\p{P}\p{S}]/u,Xr=/[^\s\p{P}\p{S}]/u,yo=S(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Ht).getRegex(),Vr=/(?!~)[\p{P}\p{S}]/u,wo=/(?!~)[\s\p{P}\p{S}]/u,To=/(?:[^\s\p{P}\p{S}]|~)/u,So=S(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",ao?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Qr=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,Ao=S(Qr,"u").replace(/punct/g,st).getRegex(),Eo=S(Qr,"u").replace(/punct/g,Vr).getRegex(),Kr="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Ro=S(Kr,"gu").replace(/notPunctSpace/g,Xr).replace(/punctSpace/g,Ht).replace(/punct/g,st).getRegex(),Co=S(Kr,"gu").replace(/notPunctSpace/g,To).replace(/punctSpace/g,wo).replace(/punct/g,Vr).getRegex(),Lo=S("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Xr).replace(/punctSpace/g,Ht).replace(/punct/g,st).getRegex(),Io=S(/\\(punct)/,"gu").replace(/punct/g,st).getRegex(),No=S(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Mo=S(Ft).replace("(?:-->|$)","-->").getRegex(),$o=S("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Mo).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),lt=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,zo=S(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",lt).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Jr=S(/^!?\[(label)\]\[(ref)\]/).replace("label",lt).replace("ref",Ot).getRegex(),en=S(/^!?\[(ref)\](?:\[\])?/).replace("ref",Ot).getRegex(),Do=S("reflink|nolink(?!\\()","g").replace("reflink",Jr).replace("nolink",en).getRegex(),tn=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,Ut={_backpedal:Be,anyPunctuation:Io,autolink:No,blockSkip:So,br:Zr,code:ko,del:Be,emStrongLDelim:Ao,emStrongRDelimAst:Ro,emStrongRDelimUnd:Lo,escape:xo,link:zo,nolink:en,punctuation:yo,reflink:Jr,reflinkSearch:Do,tag:$o,text:vo,url:Be},Po={...Ut,link:S(/^!?\[(label)\]\((.*?)\)/).replace("label",lt).getRegex(),reflink:S(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",lt).getRegex()},Wt={...Ut,emStrongRDelimAst:Co,emStrongLDelim:Eo,url:S(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",tn).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:S(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",tn).getRegex()},Oo={...Wt,br:S(Zr).replace("{2,}","*").getRegex(),text:S(Wt.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},dt={normal:Bt,gfm:_o,pedantic:bo},Ue={normal:Ut,gfm:Wt,breaks:Oo,pedantic:Po},Fo={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},rn=t=>Fo[t];function pe(t,e){if(e){if(G.escapeTest.test(t))return t.replace(G.escapeReplace,rn)}else if(G.escapeTestNoEncode.test(t))return t.replace(G.escapeReplaceNoEncode,rn);return t}function nn(t){try{t=encodeURI(t).replace(G.percentDecode,"%")}catch{return null}return t}function on(t,e){let r=t.replace(G.findPipe,(a,i,d)=>{let l=!1,u=i;for(;--u>=0&&d[u]==="\\";)l=!l;return l?"|":" |"}),o=r.split(G.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(G.slashPipe,"|");return o}function We(t,e,r){let o=t.length;if(o===0)return"";let n=0;for(;n<o&&t.charAt(o-n-1)===e;)n++;return t.slice(0,o-n)}function Bo(t,e){if(t.indexOf(e[1])===-1)return-1;let r=0;for(let o=0;o<t.length;o++)if(t[o]==="\\")o++;else if(t[o]===e[0])r++;else if(t[o]===e[1]&&(r--,r<0))return o;return r>0?-2:-1}function an(t,e,r,o,n){let a=e.href,i=e.title||null,d=t[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let l={type:t[0].charAt(0)==="!"?"image":"link",raw:r,href:a,title:i,text:d,tokens:o.inlineTokens(d)};return o.state.inLink=!1,l}function Ho(t,e,r){let o=t.match(r.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(a=>{let i=a.match(r.other.beginningSpace);if(i===null)return a;let[d]=i;return d.length>=n.length?a.slice(n.length):a}).join(`
`)}var ut=class{options;rules;lexer;constructor(t){this.options=t||ke}space(t){let e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){let e=this.rules.block.code.exec(t);if(e){let r=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?r:We(r,`
`)}}}fences(t){let e=this.rules.block.fences.exec(t);if(e){let r=e[0],o=Ho(r,e[3]||"",this.rules);return{type:"code",raw:r,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(t){let e=this.rules.block.heading.exec(t);if(e){let r=e[2].trim();if(this.rules.other.endingHash.test(r)){let o=We(r,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(r=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:r,tokens:this.lexer.inline(r)}}}hr(t){let e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:We(e[0],`
`)}}blockquote(t){let e=this.rules.block.blockquote.exec(t);if(e){let r=We(e[0],`
`).split(`
`),o="",n="",a=[];for(;r.length>0;){let i=!1,d=[],l;for(l=0;l<r.length;l++)if(this.rules.other.blockquoteStart.test(r[l]))d.push(r[l]),i=!0;else if(!i)d.push(r[l]);else break;r=r.slice(l);let u=d.join(`
`),p=u.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${u}`:u,n=n?`${n}
${p}`:p;let c=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(p,a,!0),this.lexer.state.top=c,r.length===0)break;let f=a.at(-1);if(f?.type==="code")break;if(f?.type==="blockquote"){let m=f,_=m.raw+`
`+r.join(`
`),T=this.blockquote(_);a[a.length-1]=T,o=o.substring(0,o.length-m.raw.length)+T.raw,n=n.substring(0,n.length-m.text.length)+T.text;break}else if(f?.type==="list"){let m=f,_=m.raw+`
`+r.join(`
`),T=this.list(_);a[a.length-1]=T,o=o.substring(0,o.length-f.raw.length)+T.raw,n=n.substring(0,n.length-m.raw.length)+T.raw,r=_.substring(a.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:a,text:n}}}list(t){let e=this.rules.block.list.exec(t);if(e){let r=e[1].trim(),o=r.length>1,n={type:"list",raw:"",ordered:o,start:o?+r.slice(0,-1):"",loose:!1,items:[]};r=o?`\\d{1,9}\\${r.slice(-1)}`:`\\${r}`,this.options.pedantic&&(r=o?r:"[*+-]");let a=this.rules.other.listItemRegex(r),i=!1;for(;t;){let l=!1,u="",p="";if(!(e=a.exec(t))||this.rules.block.hr.test(t))break;u=e[0],t=t.substring(u.length);let c=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,T=>" ".repeat(3*T.length)),f=t.split(`
`,1)[0],m=!c.trim(),_=0;if(this.options.pedantic?(_=2,p=c.trimStart()):m?_=e[1].length+1:(_=e[2].search(this.rules.other.nonSpaceChar),_=_>4?1:_,p=c.slice(_),_+=e[1].length),m&&this.rules.other.blankLine.test(f)&&(u+=f+`
`,t=t.substring(f.length+1),l=!0),!l){let T=this.rules.other.nextBulletRegex(_),w=this.rules.other.hrRegex(_),k=this.rules.other.fencesBeginRegex(_),v=this.rules.other.headingBeginRegex(_),z=this.rules.other.htmlBeginRegex(_);for(;t;){let E=t.split(`
`,1)[0],O;if(f=E,this.options.pedantic?(f=f.replace(this.rules.other.listReplaceNesting,"  "),O=f):O=f.replace(this.rules.other.tabCharGlobal,"    "),k.test(f)||v.test(f)||z.test(f)||T.test(f)||w.test(f))break;if(O.search(this.rules.other.nonSpaceChar)>=_||!f.trim())p+=`
`+O.slice(_);else{if(m||c.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||k.test(c)||v.test(c)||w.test(c))break;p+=`
`+f}!m&&!f.trim()&&(m=!0),u+=E+`
`,t=t.substring(E.length+1),c=O.slice(_)}}n.loose||(i?n.loose=!0:this.rules.other.doubleBlankLine.test(u)&&(i=!0)),n.items.push({type:"list_item",raw:u,task:!!this.options.gfm&&this.rules.other.listIsTask.test(p),loose:!1,text:p,tokens:[]}),n.raw+=u}let d=n.items.at(-1);if(d)d.raw=d.raw.trimEnd(),d.text=d.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let l of n.items){if(this.lexer.state.top=!1,l.tokens=this.lexer.blockTokens(l.text,[]),l.task){if(l.text=l.text.replace(this.rules.other.listReplaceTask,""),l.tokens[0]?.type==="text"||l.tokens[0]?.type==="paragraph"){l.tokens[0].raw=l.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),l.tokens[0].text=l.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let p=this.lexer.inlineQueue.length-1;p>=0;p--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[p].src)){this.lexer.inlineQueue[p].src=this.lexer.inlineQueue[p].src.replace(this.rules.other.listReplaceTask,"");break}}let u=this.rules.other.listTaskCheckbox.exec(l.raw);if(u){let p={type:"checkbox",raw:u[0]+" ",checked:u[0]!=="[ ]"};l.checked=p.checked,n.loose?l.tokens[0]&&["paragraph","text"].includes(l.tokens[0].type)&&"tokens"in l.tokens[0]&&l.tokens[0].tokens?(l.tokens[0].raw=p.raw+l.tokens[0].raw,l.tokens[0].text=p.raw+l.tokens[0].text,l.tokens[0].tokens.unshift(p)):l.tokens.unshift({type:"paragraph",raw:p.raw,text:p.raw,tokens:[p]}):l.tokens.unshift(p)}}if(!n.loose){let u=l.tokens.filter(c=>c.type==="space"),p=u.length>0&&u.some(c=>this.rules.other.anyLine.test(c.raw));n.loose=p}}if(n.loose)for(let l of n.items){l.loose=!0;for(let u of l.tokens)u.type==="text"&&(u.type="paragraph")}return n}}html(t){let e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){let e=this.rules.block.def.exec(t);if(e){let r=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:r,raw:e[0],href:o,title:n}}}table(t){let e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let r=on(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],a={type:"table",raw:e[0],header:[],align:[],rows:[]};if(r.length===o.length){for(let i of o)this.rules.other.tableAlignRight.test(i)?a.align.push("right"):this.rules.other.tableAlignCenter.test(i)?a.align.push("center"):this.rules.other.tableAlignLeft.test(i)?a.align.push("left"):a.align.push(null);for(let i=0;i<r.length;i++)a.header.push({text:r[i],tokens:this.lexer.inline(r[i]),header:!0,align:a.align[i]});for(let i of n)a.rows.push(on(i,a.header.length).map((d,l)=>({text:d,tokens:this.lexer.inline(d),header:!1,align:a.align[l]})));return a}}lheading(t){let e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){let e=this.rules.block.paragraph.exec(t);if(e){let r=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:r,tokens:this.lexer.inline(r)}}}text(t){let e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){let e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){let e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){let e=this.rules.inline.link.exec(t);if(e){let r=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let a=We(r.slice(0,-1),"\\");if((r.length-a.length)%2===0)return}else{let a=Bo(e[2],"()");if(a===-2)return;if(a>-1){let i=(e[0].indexOf("!")===0?5:4)+e[1].length+a;e[2]=e[2].substring(0,a),e[0]=e[0].substring(0,i).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(o);a&&(o=a[1],n=a[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?o=o.slice(1):o=o.slice(1,-1)),an(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let r;if((r=this.rules.inline.reflink.exec(t))||(r=this.rules.inline.nolink.exec(t))){let o=(r[2]||r[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let a=r[0].charAt(0);return{type:"text",raw:a,text:a}}return an(r,n,r[0],this.lexer,this.rules)}}emStrong(t,e,r=""){let o=this.rules.inline.emStrongLDelim.exec(t);if(!(!o||o[3]&&r.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!r||this.rules.inline.punctuation.exec(r))){let n=[...o[0]].length-1,a,i,d=n,l=0,u=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(u.lastIndex=0,e=e.slice(-1*t.length+n);(o=u.exec(e))!=null;){if(a=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!a)continue;if(i=[...a].length,o[3]||o[4]){d+=i;continue}else if((o[5]||o[6])&&n%3&&!((n+i)%3)){l+=i;continue}if(d-=i,d>0)continue;i=Math.min(i,i+d+l);let p=[...o[0]][0].length,c=t.slice(0,n+o.index+p+i);if(Math.min(n,i)%2){let m=c.slice(1,-1);return{type:"em",raw:c,text:m,tokens:this.lexer.inlineTokens(m)}}let f=c.slice(2,-2);return{type:"strong",raw:c,text:f,tokens:this.lexer.inlineTokens(f)}}}}codespan(t){let e=this.rules.inline.code.exec(t);if(e){let r=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(r),n=this.rules.other.startingSpaceChar.test(r)&&this.rules.other.endingSpaceChar.test(r);return o&&n&&(r=r.substring(1,r.length-1)),{type:"codespan",raw:e[0],text:r}}}br(t){let e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){let e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){let e=this.rules.inline.autolink.exec(t);if(e){let r,o;return e[2]==="@"?(r=e[1],o="mailto:"+r):(r=e[1],o=r),{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}url(t){let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){let e=this.rules.inline.text.exec(t);if(e){let r=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:r}}}},ee=class hr{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||ke,this.options.tokenizer=this.options.tokenizer||new ut,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let r={other:G,block:dt.normal,inline:Ue.normal};this.options.pedantic?(r.block=dt.pedantic,r.inline=Ue.pedantic):this.options.gfm&&(r.block=dt.gfm,this.options.breaks?r.inline=Ue.breaks:r.inline=Ue.gfm),this.tokenizer.rules=r}static get rules(){return{block:dt,inline:Ue}}static lex(e,r){return new hr(r).lex(e)}static lexInline(e,r){return new hr(r).inlineTokens(e)}lex(e){e=e.replace(G.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let r=0;r<this.inlineQueue.length;r++){let o=this.inlineQueue[r];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,r=[],o=!1){for(this.options.pedantic&&(e=e.replace(G.tabCharGlobal,"    ").replace(G.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(i=>(n=i.call({lexer:this},e,r))?(e=e.substring(n.raw.length),r.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let i=r.at(-1);n.raw.length===1&&i!==void 0?i.raw+=`
`:r.push(n);continue}if(n=this.tokenizer.code(e)){e=e.substring(n.raw.length);let i=r.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.text,this.inlineQueue.at(-1).src=i.text):r.push(n);continue}if(n=this.tokenizer.fences(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.heading(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.hr(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.blockquote(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.list(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.html(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.def(e)){e=e.substring(n.raw.length);let i=r.at(-1);i?.type==="paragraph"||i?.type==="text"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.raw,this.inlineQueue.at(-1).src=i.text):this.tokens.links[n.tag]||(this.tokens.links[n.tag]={href:n.href,title:n.title},r.push(n));continue}if(n=this.tokenizer.table(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.lheading(e)){e=e.substring(n.raw.length),r.push(n);continue}let a=e;if(this.options.extensions?.startBlock){let i=1/0,d=e.slice(1),l;this.options.extensions.startBlock.forEach(u=>{l=u.call({lexer:this},d),typeof l=="number"&&l>=0&&(i=Math.min(i,l))}),i<1/0&&i>=0&&(a=e.substring(0,i+1))}if(this.state.top&&(n=this.tokenizer.paragraph(a))){let i=r.at(-1);o&&i?.type==="paragraph"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):r.push(n),o=a.length!==e.length,e=e.substring(n.raw.length);continue}if(n=this.tokenizer.text(e)){e=e.substring(n.raw.length);let i=r.at(-1);i?.type==="text"?(i.raw+=(i.raw.endsWith(`
`)?"":`
`)+n.raw,i.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=i.text):r.push(n);continue}if(e){let i="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(i);break}else throw new Error(i)}}return this.state.top=!0,r}inline(e,r=[]){return this.inlineQueue.push({src:e,tokens:r}),r}inlineTokens(e,r=[]){let o=e,n=null;if(this.tokens.links){let l=Object.keys(this.tokens.links);if(l.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)l.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)a=n[2]?n[2].length:0,o=o.slice(0,n.index+a)+"["+"a".repeat(n[0].length-a-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let i=!1,d="";for(;e;){i||(d=""),i=!1;let l;if(this.options.extensions?.inline?.some(p=>(l=p.call({lexer:this},e,r))?(e=e.substring(l.raw.length),r.push(l),!0):!1))continue;if(l=this.tokenizer.escape(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.tag(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.link(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(l.raw.length);let p=r.at(-1);l.type==="text"&&p?.type==="text"?(p.raw+=l.raw,p.text+=l.text):r.push(l);continue}if(l=this.tokenizer.emStrong(e,o,d)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.codespan(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.br(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.del(e)){e=e.substring(l.raw.length),r.push(l);continue}if(l=this.tokenizer.autolink(e)){e=e.substring(l.raw.length),r.push(l);continue}if(!this.state.inLink&&(l=this.tokenizer.url(e))){e=e.substring(l.raw.length),r.push(l);continue}let u=e;if(this.options.extensions?.startInline){let p=1/0,c=e.slice(1),f;this.options.extensions.startInline.forEach(m=>{f=m.call({lexer:this},c),typeof f=="number"&&f>=0&&(p=Math.min(p,f))}),p<1/0&&p>=0&&(u=e.substring(0,p+1))}if(l=this.tokenizer.inlineText(u)){e=e.substring(l.raw.length),l.raw.slice(-1)!=="_"&&(d=l.raw.slice(-1)),i=!0;let p=r.at(-1);p?.type==="text"?(p.raw+=l.raw,p.text+=l.text):r.push(l);continue}if(e){let p="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(p);break}else throw new Error(p)}}return r}},ct=class{options;parser;constructor(t){this.options=t||ke}space(t){return""}code({text:t,lang:e,escaped:r}){let o=(e||"").match(G.notSpaceStart)?.[0],n=t.replace(G.endingNewline,"")+`
`;return o?'<pre><code class="language-'+pe(o)+'">'+(r?n:pe(n,!0))+`</code></pre>
`:"<pre><code>"+(r?n:pe(n,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}def(t){return""}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){let e=t.ordered,r=t.start,o="";for(let i=0;i<t.items.length;i++){let d=t.items[i];o+=this.listitem(d)}let n=e?"ol":"ul",a=e&&r!==1?' start="'+r+'"':"";return"<"+n+a+`>
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
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${pe(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:r}){let o=this.parser.parseInline(r),n=nn(t);if(n===null)return o;t=n;let a='<a href="'+t+'"';return e&&(a+=' title="'+pe(e)+'"'),a+=">"+o+"</a>",a}image({href:t,title:e,text:r,tokens:o}){o&&(r=this.parser.parseInline(o,this.parser.textRenderer));let n=nn(t);if(n===null)return pe(r);t=n;let a=`<img src="${t}" alt="${r}"`;return e&&(a+=` title="${pe(e)}"`),a+=">",a}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:pe(t.text)}},Gt=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}checkbox({raw:t}){return t}},te=class fr{options;renderer;textRenderer;constructor(e){this.options=e||ke,this.options.renderer=this.options.renderer||new ct,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Gt}static parse(e,r){return new fr(r).parse(e)}static parseInline(e,r){return new fr(r).parseInline(e)}parse(e){let r="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let i=n,d=this.options.extensions.renderers[i.type].call({parser:this},i);if(d!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(i.type)){r+=d||"";continue}}let a=n;switch(a.type){case"space":{r+=this.renderer.space(a);break}case"hr":{r+=this.renderer.hr(a);break}case"heading":{r+=this.renderer.heading(a);break}case"code":{r+=this.renderer.code(a);break}case"table":{r+=this.renderer.table(a);break}case"blockquote":{r+=this.renderer.blockquote(a);break}case"list":{r+=this.renderer.list(a);break}case"checkbox":{r+=this.renderer.checkbox(a);break}case"html":{r+=this.renderer.html(a);break}case"def":{r+=this.renderer.def(a);break}case"paragraph":{r+=this.renderer.paragraph(a);break}case"text":{r+=this.renderer.text(a);break}default:{let i='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(i),"";throw new Error(i)}}}return r}parseInline(e,r=this.renderer){let o="";for(let n=0;n<e.length;n++){let a=e[n];if(this.options.extensions?.renderers?.[a.type]){let d=this.options.extensions.renderers[a.type].call({parser:this},a);if(d!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){o+=d||"";continue}}let i=a;switch(i.type){case"escape":{o+=r.text(i);break}case"html":{o+=r.html(i);break}case"link":{o+=r.link(i);break}case"image":{o+=r.image(i);break}case"checkbox":{o+=r.checkbox(i);break}case"strong":{o+=r.strong(i);break}case"em":{o+=r.em(i);break}case"codespan":{o+=r.codespan(i);break}case"br":{o+=r.br(i);break}case"del":{o+=r.del(i);break}case"text":{o+=r.text(i);break}default:{let d='Token with "'+i.type+'" type was not found.';if(this.options.silent)return console.error(d),"";throw new Error(d)}}}return o}},Ge=class{options;block;constructor(t){this.options=t||ke}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}emStrongMask(t){return t}provideLexer(){return this.block?ee.lex:ee.lexInline}provideParser(){return this.block?te.parse:te.parseInline}},Uo=class{defaults=zt();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=te;Renderer=ct;TextRenderer=Gt;Lexer=ee;Tokenizer=ut;Hooks=Ge;constructor(...t){this.use(...t)}walkTokens(t,e){let r=[];for(let o of t)switch(r=r.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let a of n.header)r=r.concat(this.walkTokens(a.tokens,e));for(let a of n.rows)for(let i of a)r=r.concat(this.walkTokens(i.tokens,e));break}case"list":{let n=o;r=r.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(a=>{let i=n[a].flat(1/0);r=r.concat(this.walkTokens(i,e))}):n.tokens&&(r=r.concat(this.walkTokens(n.tokens,e)))}}return r}use(...t){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(r=>{let o={...r};if(o.async=this.defaults.async||o.async||!1,r.extensions&&(r.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let a=e.renderers[n.name];a?e.renderers[n.name]=function(...i){let d=n.renderer.apply(this,i);return d===!1&&(d=a.apply(this,i)),d}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=e[n.level];a?a.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),r.renderer){let n=this.defaults.renderer||new ct(this.defaults);for(let a in r.renderer){if(!(a in n))throw new Error(`renderer '${a}' does not exist`);if(["options","parser"].includes(a))continue;let i=a,d=r.renderer[i],l=n[i];n[i]=(...u)=>{let p=d.apply(n,u);return p===!1&&(p=l.apply(n,u)),p||""}}o.renderer=n}if(r.tokenizer){let n=this.defaults.tokenizer||new ut(this.defaults);for(let a in r.tokenizer){if(!(a in n))throw new Error(`tokenizer '${a}' does not exist`);if(["options","rules","lexer"].includes(a))continue;let i=a,d=r.tokenizer[i],l=n[i];n[i]=(...u)=>{let p=d.apply(n,u);return p===!1&&(p=l.apply(n,u)),p}}o.tokenizer=n}if(r.hooks){let n=this.defaults.hooks||new Ge;for(let a in r.hooks){if(!(a in n))throw new Error(`hook '${a}' does not exist`);if(["options","block"].includes(a))continue;let i=a,d=r.hooks[i],l=n[i];Ge.passThroughHooks.has(a)?n[i]=u=>{if(this.defaults.async&&Ge.passThroughHooksRespectAsync.has(a))return(async()=>{let c=await d.call(n,u);return l.call(n,c)})();let p=d.call(n,u);return l.call(n,p)}:n[i]=(...u)=>{if(this.defaults.async)return(async()=>{let c=await d.apply(n,u);return c===!1&&(c=await l.apply(n,u)),c})();let p=d.apply(n,u);return p===!1&&(p=l.apply(n,u)),p}}o.hooks=n}if(r.walkTokens){let n=this.defaults.walkTokens,a=r.walkTokens;o.walkTokens=function(i){let d=[];return d.push(a.call(this,i)),n&&(d=d.concat(n.call(this,i))),d}}this.defaults={...this.defaults,...o}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return ee.lex(t,e??this.defaults)}parser(t,e){return te.parse(t,e??this.defaults)}parseMarkdown(t){return(e,r)=>{let o={...r},n={...this.defaults,...o},a=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=t),n.async)return(async()=>{let i=n.hooks?await n.hooks.preprocess(e):e,d=await(n.hooks?await n.hooks.provideLexer():t?ee.lex:ee.lexInline)(i,n),l=n.hooks?await n.hooks.processAllTokens(d):d;n.walkTokens&&await Promise.all(this.walkTokens(l,n.walkTokens));let u=await(n.hooks?await n.hooks.provideParser():t?te.parse:te.parseInline)(l,n);return n.hooks?await n.hooks.postprocess(u):u})().catch(a);try{n.hooks&&(e=n.hooks.preprocess(e));let i=(n.hooks?n.hooks.provideLexer():t?ee.lex:ee.lexInline)(e,n);n.hooks&&(i=n.hooks.processAllTokens(i)),n.walkTokens&&this.walkTokens(i,n.walkTokens);let d=(n.hooks?n.hooks.provideParser():t?te.parse:te.parseInline)(i,n);return n.hooks&&(d=n.hooks.postprocess(d)),d}catch(i){return a(i)}}}onError(t,e){return r=>{if(r.message+=`
Please report this to https://github.com/markedjs/marked.`,t){let o="<p>An error occurred:</p><pre>"+pe(r.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(r);throw r}}},ve=new Uo;function A(t,e){return ve.parse(t,e)}A.options=A.setOptions=function(t){return ve.setOptions(t),A.defaults=ve.defaults,Wr(A.defaults),A},A.getDefaults=zt,A.defaults=ke,A.use=function(...t){return ve.use(...t),A.defaults=ve.defaults,Wr(A.defaults),A},A.walkTokens=function(t,e){return ve.walkTokens(t,e)},A.parseInline=ve.parseInline,A.Parser=te,A.parser=te.parse,A.Renderer=ct,A.TextRenderer=Gt,A.Lexer=ee,A.lexer=ee.lex,A.Tokenizer=ut,A.Hooks=Ge,A.parse=A,A.options,A.setOptions,A.use,A.walkTokens,A.parseInline,te.parse,ee.lex;const{entries:sn,setPrototypeOf:ln,isFrozen:Wo,getPrototypeOf:Go,getOwnPropertyDescriptor:jo}=Object;let{freeze:j,seal:J,create:jt}=Object,{apply:qt,construct:Yt}=typeof Reflect<"u"&&Reflect;j||(j=function(e){return e}),J||(J=function(e){return e}),qt||(qt=function(e,r){for(var o=arguments.length,n=new Array(o>2?o-2:0),a=2;a<o;a++)n[a-2]=arguments[a];return e.apply(r,n)}),Yt||(Yt=function(e){for(var r=arguments.length,o=new Array(r>1?r-1:0),n=1;n<r;n++)o[n-1]=arguments[n];return new e(...o)});const gt=Y(Array.prototype.forEach),qo=Y(Array.prototype.lastIndexOf),dn=Y(Array.prototype.pop),je=Y(Array.prototype.push),Yo=Y(Array.prototype.splice),pt=Y(String.prototype.toLowerCase),Zt=Y(String.prototype.toString),Xt=Y(String.prototype.match),qe=Y(String.prototype.replace),Zo=Y(String.prototype.indexOf),Xo=Y(String.prototype.trim),re=Y(Object.prototype.hasOwnProperty),q=Y(RegExp.prototype.test),Ye=Vo(TypeError);function Y(t){return function(e){e instanceof RegExp&&(e.lastIndex=0);for(var r=arguments.length,o=new Array(r>1?r-1:0),n=1;n<r;n++)o[n-1]=arguments[n];return qt(t,e,o)}}function Vo(t){return function(){for(var e=arguments.length,r=new Array(e),o=0;o<e;o++)r[o]=arguments[o];return Yt(t,r)}}function y(t,e){let r=arguments.length>2&&arguments[2]!==void 0?arguments[2]:pt;ln&&ln(t,null);let o=e.length;for(;o--;){let n=e[o];if(typeof n=="string"){const a=r(n);a!==n&&(Wo(e)||(e[o]=a),n=a)}t[n]=!0}return t}function Qo(t){for(let e=0;e<t.length;e++)re(t,e)||(t[e]=null);return t}function ae(t){const e=jt(null);for(const[r,o]of sn(t))re(t,r)&&(Array.isArray(o)?e[r]=Qo(o):o&&typeof o=="object"&&o.constructor===Object?e[r]=ae(o):e[r]=o);return e}function Ze(t,e){for(;t!==null;){const o=jo(t,e);if(o){if(o.get)return Y(o.get);if(typeof o.value=="function")return Y(o.value)}t=Go(t)}function r(){return null}return r}const un=j(["a","abbr","acronym","address","area","article","aside","audio","b","bdi","bdo","big","blink","blockquote","body","br","button","canvas","caption","center","cite","code","col","colgroup","content","data","datalist","dd","decorator","del","details","dfn","dialog","dir","div","dl","dt","element","em","fieldset","figcaption","figure","font","footer","form","h1","h2","h3","h4","h5","h6","head","header","hgroup","hr","html","i","img","input","ins","kbd","label","legend","li","main","map","mark","marquee","menu","menuitem","meter","nav","nobr","ol","optgroup","option","output","p","picture","pre","progress","q","rp","rt","ruby","s","samp","search","section","select","shadow","slot","small","source","spacer","span","strike","strong","style","sub","summary","sup","table","tbody","td","template","textarea","tfoot","th","thead","time","tr","track","tt","u","ul","var","video","wbr"]),Vt=j(["svg","a","altglyph","altglyphdef","altglyphitem","animatecolor","animatemotion","animatetransform","circle","clippath","defs","desc","ellipse","enterkeyhint","exportparts","filter","font","g","glyph","glyphref","hkern","image","inputmode","line","lineargradient","marker","mask","metadata","mpath","part","path","pattern","polygon","polyline","radialgradient","rect","stop","style","switch","symbol","text","textpath","title","tref","tspan","view","vkern"]),Qt=j(["feBlend","feColorMatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feDistantLight","feDropShadow","feFlood","feFuncA","feFuncB","feFuncG","feFuncR","feGaussianBlur","feImage","feMerge","feMergeNode","feMorphology","feOffset","fePointLight","feSpecularLighting","feSpotLight","feTile","feTurbulence"]),Ko=j(["animate","color-profile","cursor","discard","font-face","font-face-format","font-face-name","font-face-src","font-face-uri","foreignobject","hatch","hatchpath","mesh","meshgradient","meshpatch","meshrow","missing-glyph","script","set","solidcolor","unknown","use"]),Kt=j(["math","menclose","merror","mfenced","mfrac","mglyph","mi","mlabeledtr","mmultiscripts","mn","mo","mover","mpadded","mphantom","mroot","mrow","ms","mspace","msqrt","mstyle","msub","msup","msubsup","mtable","mtd","mtext","mtr","munder","munderover","mprescripts"]),Jo=j(["maction","maligngroup","malignmark","mlongdiv","mscarries","mscarry","msgroup","mstack","msline","msrow","semantics","annotation","annotation-xml","mprescripts","none"]),cn=j(["#text"]),gn=j(["accept","action","align","alt","autocapitalize","autocomplete","autopictureinpicture","autoplay","background","bgcolor","border","capture","cellpadding","cellspacing","checked","cite","class","clear","color","cols","colspan","controls","controlslist","coords","crossorigin","datetime","decoding","default","dir","disabled","disablepictureinpicture","disableremoteplayback","download","draggable","enctype","enterkeyhint","exportparts","face","for","headers","height","hidden","high","href","hreflang","id","inert","inputmode","integrity","ismap","kind","label","lang","list","loading","loop","low","max","maxlength","media","method","min","minlength","multiple","muted","name","nonce","noshade","novalidate","nowrap","open","optimum","part","pattern","placeholder","playsinline","popover","popovertarget","popovertargetaction","poster","preload","pubdate","radiogroup","readonly","rel","required","rev","reversed","role","rows","rowspan","spellcheck","scope","selected","shape","size","sizes","slot","span","srclang","start","src","srcset","step","style","summary","tabindex","title","translate","type","usemap","valign","value","width","wrap","xmlns","slot"]),Jt=j(["accent-height","accumulate","additive","alignment-baseline","amplitude","ascent","attributename","attributetype","azimuth","basefrequency","baseline-shift","begin","bias","by","class","clip","clippathunits","clip-path","clip-rule","color","color-interpolation","color-interpolation-filters","color-profile","color-rendering","cx","cy","d","dx","dy","diffuseconstant","direction","display","divisor","dur","edgemode","elevation","end","exponent","fill","fill-opacity","fill-rule","filter","filterunits","flood-color","flood-opacity","font-family","font-size","font-size-adjust","font-stretch","font-style","font-variant","font-weight","fx","fy","g1","g2","glyph-name","glyphref","gradientunits","gradienttransform","height","href","id","image-rendering","in","in2","intercept","k","k1","k2","k3","k4","kerning","keypoints","keysplines","keytimes","lang","lengthadjust","letter-spacing","kernelmatrix","kernelunitlength","lighting-color","local","marker-end","marker-mid","marker-start","markerheight","markerunits","markerwidth","maskcontentunits","maskunits","max","mask","mask-type","media","method","mode","min","name","numoctaves","offset","operator","opacity","order","orient","orientation","origin","overflow","paint-order","path","pathlength","patterncontentunits","patterntransform","patternunits","points","preservealpha","preserveaspectratio","primitiveunits","r","rx","ry","radius","refx","refy","repeatcount","repeatdur","restart","result","rotate","scale","seed","shape-rendering","slope","specularconstant","specularexponent","spreadmethod","startoffset","stddeviation","stitchtiles","stop-color","stop-opacity","stroke-dasharray","stroke-dashoffset","stroke-linecap","stroke-linejoin","stroke-miterlimit","stroke-opacity","stroke","stroke-width","style","surfacescale","systemlanguage","tabindex","tablevalues","targetx","targety","transform","transform-origin","text-anchor","text-decoration","text-rendering","textlength","type","u1","u2","unicode","values","viewbox","visibility","version","vert-adv-y","vert-origin-x","vert-origin-y","width","word-spacing","wrap","writing-mode","xchannelselector","ychannelselector","x","x1","x2","xmlns","y","y1","y2","z","zoomandpan"]),pn=j(["accent","accentunder","align","bevelled","close","columnsalign","columnlines","columnspan","denomalign","depth","dir","display","displaystyle","encoding","fence","frame","height","href","id","largeop","length","linethickness","lspace","lquote","mathbackground","mathcolor","mathsize","mathvariant","maxsize","minsize","movablelimits","notation","numalign","open","rowalign","rowlines","rowspacing","rowspan","rspace","rquote","scriptlevel","scriptminsize","scriptsizemultiplier","selection","separator","separators","stretchy","subscriptshift","supscriptshift","symmetric","voffset","width","xmlns"]),ht=j(["xlink:href","xml:id","xlink:title","xml:space","xmlns:xlink"]),ea=J(/\{\{[\w\W]*|[\w\W]*\}\}/gm),ta=J(/<%[\w\W]*|[\w\W]*%>/gm),ra=J(/\$\{[\w\W]*/gm),na=J(/^data-[\-\w.\u00B7-\uFFFF]+$/),oa=J(/^aria-[\-\w]+$/),hn=J(/^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i),aa=J(/^(?:\w+script|data):/i),ia=J(/[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g),fn=J(/^html$/i),sa=J(/^[a-z][.\w]*(-[.\w]+)+$/i);var mn=Object.freeze({__proto__:null,ARIA_ATTR:oa,ATTR_WHITESPACE:ia,CUSTOM_ELEMENT:sa,DATA_ATTR:na,DOCTYPE_NAME:fn,ERB_EXPR:ta,IS_ALLOWED_URI:hn,IS_SCRIPT_OR_DATA:aa,MUSTACHE_EXPR:ea,TMPLIT_EXPR:ra});const Xe={element:1,text:3,progressingInstruction:7,comment:8,document:9},la=function(){return typeof window>"u"?null:window},da=function(e,r){if(typeof e!="object"||typeof e.createPolicy!="function")return null;let o=null;const n="data-tt-policy-suffix";r&&r.hasAttribute(n)&&(o=r.getAttribute(n));const a="dompurify"+(o?"#"+o:"");try{return e.createPolicy(a,{createHTML(i){return i},createScriptURL(i){return i}})}catch{return console.warn("TrustedTypes policy "+a+" could not be created."),null}},_n=function(){return{afterSanitizeAttributes:[],afterSanitizeElements:[],afterSanitizeShadowDOM:[],beforeSanitizeAttributes:[],beforeSanitizeElements:[],beforeSanitizeShadowDOM:[],uponSanitizeAttribute:[],uponSanitizeElement:[],uponSanitizeShadowNode:[]}};function bn(){let t=arguments.length>0&&arguments[0]!==void 0?arguments[0]:la();const e=x=>bn(x);if(e.version="3.3.1",e.removed=[],!t||!t.document||t.document.nodeType!==Xe.document||!t.Element)return e.isSupported=!1,e;let{document:r}=t;const o=r,n=o.currentScript,{DocumentFragment:a,HTMLTemplateElement:i,Node:d,Element:l,NodeFilter:u,NamedNodeMap:p=t.NamedNodeMap||t.MozNamedAttrMap,HTMLFormElement:c,DOMParser:f,trustedTypes:m}=t,_=l.prototype,T=Ze(_,"cloneNode"),w=Ze(_,"remove"),k=Ze(_,"nextSibling"),v=Ze(_,"childNodes"),z=Ze(_,"parentNode");if(typeof i=="function"){const x=r.createElement("template");x.content&&x.content.ownerDocument&&(r=x.content.ownerDocument)}let E,O="";const{implementation:K,createNodeIterator:ie,createDocumentFragment:se,getElementsByTagName:I}=r,{importNode:Z}=o;let C=_n();e.isSupported=typeof sn=="function"&&typeof z=="function"&&K&&K.createHTMLDocument!==void 0;const{MUSTACHE_EXPR:X,ERB_EXPR:V,TMPLIT_EXPR:ne,DATA_ATTR:ye,ARIA_ATTR:le,IS_SCRIPT_OR_DATA:rr,ATTR_WHITESPACE:Re,CUSTOM_ELEMENT:Ce}=mn;let{IS_ALLOWED_URI:_e}=mn,F=null;const Ve=y({},[...un,...Vt,...Qt,...Kt,...cn]);let D=null;const N=y({},[...gn,...Jt,...pn,...ht]);let R=Object.seal(jt(null,{tagNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeNameCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},allowCustomizedBuiltInElements:{writable:!0,configurable:!1,enumerable:!0,value:!1}})),oe=null,we=null;const Le=Object.seal(jt(null,{tagCheck:{writable:!0,configurable:!1,enumerable:!0,value:null},attributeCheck:{writable:!0,configurable:!1,enumerable:!0,value:null}}));let En=!0,nr=!0,Rn=!1,Cn=!0,Ie=!1,ft=!0,Te=!1,or=!1,ar=!1,Ne=!1,mt=!1,_t=!1,Ln=!0,In=!1;const Ma="user-content-";let ir=!0,Qe=!1,Me={},de=null;const sr=y({},["annotation-xml","audio","colgroup","desc","foreignobject","head","iframe","math","mi","mn","mo","ms","mtext","noembed","noframes","noscript","plaintext","script","style","svg","template","thead","title","video","xmp"]);let Nn=null;const Mn=y({},["audio","video","img","source","image","track"]);let lr=null;const $n=y({},["alt","class","for","id","label","name","pattern","placeholder","role","summary","title","value","style","xmlns"]),bt="http://www.w3.org/1998/Math/MathML",xt="http://www.w3.org/2000/svg",he="http://www.w3.org/1999/xhtml";let $e=he,dr=!1,ur=null;const $a=y({},[bt,xt,he],Zt);let kt=y({},["mi","mo","mn","ms","mtext"]),vt=y({},["annotation-xml"]);const za=y({},["title","style","font","a","script"]);let Ke=null;const Da=["application/xhtml+xml","text/html"],Pa="text/html";let H=null,ze=null;const Oa=r.createElement("form"),zn=function(s){return s instanceof RegExp||s instanceof Function},cr=function(){let s=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};if(!(ze&&ze===s)){if((!s||typeof s!="object")&&(s={}),s=ae(s),Ke=Da.indexOf(s.PARSER_MEDIA_TYPE)===-1?Pa:s.PARSER_MEDIA_TYPE,H=Ke==="application/xhtml+xml"?Zt:pt,F=re(s,"ALLOWED_TAGS")?y({},s.ALLOWED_TAGS,H):Ve,D=re(s,"ALLOWED_ATTR")?y({},s.ALLOWED_ATTR,H):N,ur=re(s,"ALLOWED_NAMESPACES")?y({},s.ALLOWED_NAMESPACES,Zt):$a,lr=re(s,"ADD_URI_SAFE_ATTR")?y(ae($n),s.ADD_URI_SAFE_ATTR,H):$n,Nn=re(s,"ADD_DATA_URI_TAGS")?y(ae(Mn),s.ADD_DATA_URI_TAGS,H):Mn,de=re(s,"FORBID_CONTENTS")?y({},s.FORBID_CONTENTS,H):sr,oe=re(s,"FORBID_TAGS")?y({},s.FORBID_TAGS,H):ae({}),we=re(s,"FORBID_ATTR")?y({},s.FORBID_ATTR,H):ae({}),Me=re(s,"USE_PROFILES")?s.USE_PROFILES:!1,En=s.ALLOW_ARIA_ATTR!==!1,nr=s.ALLOW_DATA_ATTR!==!1,Rn=s.ALLOW_UNKNOWN_PROTOCOLS||!1,Cn=s.ALLOW_SELF_CLOSE_IN_ATTR!==!1,Ie=s.SAFE_FOR_TEMPLATES||!1,ft=s.SAFE_FOR_XML!==!1,Te=s.WHOLE_DOCUMENT||!1,Ne=s.RETURN_DOM||!1,mt=s.RETURN_DOM_FRAGMENT||!1,_t=s.RETURN_TRUSTED_TYPE||!1,ar=s.FORCE_BODY||!1,Ln=s.SANITIZE_DOM!==!1,In=s.SANITIZE_NAMED_PROPS||!1,ir=s.KEEP_CONTENT!==!1,Qe=s.IN_PLACE||!1,_e=s.ALLOWED_URI_REGEXP||hn,$e=s.NAMESPACE||he,kt=s.MATHML_TEXT_INTEGRATION_POINTS||kt,vt=s.HTML_INTEGRATION_POINTS||vt,R=s.CUSTOM_ELEMENT_HANDLING||{},s.CUSTOM_ELEMENT_HANDLING&&zn(s.CUSTOM_ELEMENT_HANDLING.tagNameCheck)&&(R.tagNameCheck=s.CUSTOM_ELEMENT_HANDLING.tagNameCheck),s.CUSTOM_ELEMENT_HANDLING&&zn(s.CUSTOM_ELEMENT_HANDLING.attributeNameCheck)&&(R.attributeNameCheck=s.CUSTOM_ELEMENT_HANDLING.attributeNameCheck),s.CUSTOM_ELEMENT_HANDLING&&typeof s.CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements=="boolean"&&(R.allowCustomizedBuiltInElements=s.CUSTOM_ELEMENT_HANDLING.allowCustomizedBuiltInElements),Ie&&(nr=!1),mt&&(Ne=!0),Me&&(F=y({},cn),D=[],Me.html===!0&&(y(F,un),y(D,gn)),Me.svg===!0&&(y(F,Vt),y(D,Jt),y(D,ht)),Me.svgFilters===!0&&(y(F,Qt),y(D,Jt),y(D,ht)),Me.mathMl===!0&&(y(F,Kt),y(D,pn),y(D,ht))),s.ADD_TAGS&&(typeof s.ADD_TAGS=="function"?Le.tagCheck=s.ADD_TAGS:(F===Ve&&(F=ae(F)),y(F,s.ADD_TAGS,H))),s.ADD_ATTR&&(typeof s.ADD_ATTR=="function"?Le.attributeCheck=s.ADD_ATTR:(D===N&&(D=ae(D)),y(D,s.ADD_ATTR,H))),s.ADD_URI_SAFE_ATTR&&y(lr,s.ADD_URI_SAFE_ATTR,H),s.FORBID_CONTENTS&&(de===sr&&(de=ae(de)),y(de,s.FORBID_CONTENTS,H)),s.ADD_FORBID_CONTENTS&&(de===sr&&(de=ae(de)),y(de,s.ADD_FORBID_CONTENTS,H)),ir&&(F["#text"]=!0),Te&&y(F,["html","head","body"]),F.table&&(y(F,["tbody"]),delete oe.tbody),s.TRUSTED_TYPES_POLICY){if(typeof s.TRUSTED_TYPES_POLICY.createHTML!="function")throw Ye('TRUSTED_TYPES_POLICY configuration option must provide a "createHTML" hook.');if(typeof s.TRUSTED_TYPES_POLICY.createScriptURL!="function")throw Ye('TRUSTED_TYPES_POLICY configuration option must provide a "createScriptURL" hook.');E=s.TRUSTED_TYPES_POLICY,O=E.createHTML("")}else E===void 0&&(E=da(m,n)),E!==null&&typeof O=="string"&&(O=E.createHTML(""));j&&j(s),ze=s}},Dn=y({},[...Vt,...Qt,...Ko]),Pn=y({},[...Kt,...Jo]),Fa=function(s){let h=z(s);(!h||!h.tagName)&&(h={namespaceURI:$e,tagName:"template"});const b=pt(s.tagName),M=pt(h.tagName);return ur[s.namespaceURI]?s.namespaceURI===xt?h.namespaceURI===he?b==="svg":h.namespaceURI===bt?b==="svg"&&(M==="annotation-xml"||kt[M]):!!Dn[b]:s.namespaceURI===bt?h.namespaceURI===he?b==="math":h.namespaceURI===xt?b==="math"&&vt[M]:!!Pn[b]:s.namespaceURI===he?h.namespaceURI===xt&&!vt[M]||h.namespaceURI===bt&&!kt[M]?!1:!Pn[b]&&(za[b]||!Dn[b]):!!(Ke==="application/xhtml+xml"&&ur[s.namespaceURI]):!1},ue=function(s){je(e.removed,{element:s});try{z(s).removeChild(s)}catch{w(s)}},Se=function(s,h){try{je(e.removed,{attribute:h.getAttributeNode(s),from:h})}catch{je(e.removed,{attribute:null,from:h})}if(h.removeAttribute(s),s==="is")if(Ne||mt)try{ue(h)}catch{}else try{h.setAttribute(s,"")}catch{}},On=function(s){let h=null,b=null;if(ar)s="<remove></remove>"+s;else{const B=Xt(s,/^[\r\n\t ]+/);b=B&&B[0]}Ke==="application/xhtml+xml"&&$e===he&&(s='<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>'+s+"</body></html>");const M=E?E.createHTML(s):s;if($e===he)try{h=new f().parseFromString(M,Ke)}catch{}if(!h||!h.documentElement){h=K.createDocument($e,"template",null);try{h.documentElement.innerHTML=dr?O:M}catch{}}const W=h.body||h.documentElement;return s&&b&&W.insertBefore(r.createTextNode(b),W.childNodes[0]||null),$e===he?I.call(h,Te?"html":"body")[0]:Te?h.documentElement:W},Fn=function(s){return ie.call(s.ownerDocument||s,s,u.SHOW_ELEMENT|u.SHOW_COMMENT|u.SHOW_TEXT|u.SHOW_PROCESSING_INSTRUCTION|u.SHOW_CDATA_SECTION,null)},gr=function(s){return s instanceof c&&(typeof s.nodeName!="string"||typeof s.textContent!="string"||typeof s.removeChild!="function"||!(s.attributes instanceof p)||typeof s.removeAttribute!="function"||typeof s.setAttribute!="function"||typeof s.namespaceURI!="string"||typeof s.insertBefore!="function"||typeof s.hasChildNodes!="function")},Bn=function(s){return typeof d=="function"&&s instanceof d};function fe(x,s,h){gt(x,b=>{b.call(e,s,h,ze)})}const Hn=function(s){let h=null;if(fe(C.beforeSanitizeElements,s,null),gr(s))return ue(s),!0;const b=H(s.nodeName);if(fe(C.uponSanitizeElement,s,{tagName:b,allowedTags:F}),ft&&s.hasChildNodes()&&!Bn(s.firstElementChild)&&q(/<[/\w!]/g,s.innerHTML)&&q(/<[/\w!]/g,s.textContent)||s.nodeType===Xe.progressingInstruction||ft&&s.nodeType===Xe.comment&&q(/<[/\w]/g,s.data))return ue(s),!0;if(!(Le.tagCheck instanceof Function&&Le.tagCheck(b))&&(!F[b]||oe[b])){if(!oe[b]&&Wn(b)&&(R.tagNameCheck instanceof RegExp&&q(R.tagNameCheck,b)||R.tagNameCheck instanceof Function&&R.tagNameCheck(b)))return!1;if(ir&&!de[b]){const M=z(s)||s.parentNode,W=v(s)||s.childNodes;if(W&&M){const B=W.length;for(let Q=B-1;Q>=0;--Q){const me=T(W[Q],!0);me.__removalCount=(s.__removalCount||0)+1,M.insertBefore(me,k(s))}}}return ue(s),!0}return s instanceof l&&!Fa(s)||(b==="noscript"||b==="noembed"||b==="noframes")&&q(/<\/no(script|embed|frames)/i,s.innerHTML)?(ue(s),!0):(Ie&&s.nodeType===Xe.text&&(h=s.textContent,gt([X,V,ne],M=>{h=qe(h,M," ")}),s.textContent!==h&&(je(e.removed,{element:s.cloneNode()}),s.textContent=h)),fe(C.afterSanitizeElements,s,null),!1)},Un=function(s,h,b){if(Ln&&(h==="id"||h==="name")&&(b in r||b in Oa))return!1;if(!(nr&&!we[h]&&q(ye,h))){if(!(En&&q(le,h))){if(!(Le.attributeCheck instanceof Function&&Le.attributeCheck(h,s))){if(!D[h]||we[h]){if(!(Wn(s)&&(R.tagNameCheck instanceof RegExp&&q(R.tagNameCheck,s)||R.tagNameCheck instanceof Function&&R.tagNameCheck(s))&&(R.attributeNameCheck instanceof RegExp&&q(R.attributeNameCheck,h)||R.attributeNameCheck instanceof Function&&R.attributeNameCheck(h,s))||h==="is"&&R.allowCustomizedBuiltInElements&&(R.tagNameCheck instanceof RegExp&&q(R.tagNameCheck,b)||R.tagNameCheck instanceof Function&&R.tagNameCheck(b))))return!1}else if(!lr[h]){if(!q(_e,qe(b,Re,""))){if(!((h==="src"||h==="xlink:href"||h==="href")&&s!=="script"&&Zo(b,"data:")===0&&Nn[s])){if(!(Rn&&!q(rr,qe(b,Re,"")))){if(b)return!1}}}}}}}return!0},Wn=function(s){return s!=="annotation-xml"&&Xt(s,Ce)},Gn=function(s){fe(C.beforeSanitizeAttributes,s,null);const{attributes:h}=s;if(!h||gr(s))return;const b={attrName:"",attrValue:"",keepAttr:!0,allowedAttributes:D,forceKeepAttr:void 0};let M=h.length;for(;M--;){const W=h[M],{name:B,namespaceURI:Q,value:me}=W,De=H(B),pr=me;let U=B==="value"?pr:Xo(pr);if(b.attrName=De,b.attrValue=U,b.keepAttr=!0,b.forceKeepAttr=void 0,fe(C.uponSanitizeAttribute,s,b),U=b.attrValue,In&&(De==="id"||De==="name")&&(Se(B,s),U=Ma+U),ft&&q(/((--!?|])>)|<\/(style|title|textarea)/i,U)){Se(B,s);continue}if(De==="attributename"&&Xt(U,"href")){Se(B,s);continue}if(b.forceKeepAttr)continue;if(!b.keepAttr){Se(B,s);continue}if(!Cn&&q(/\/>/i,U)){Se(B,s);continue}Ie&&gt([X,V,ne],qn=>{U=qe(U,qn," ")});const jn=H(s.nodeName);if(!Un(jn,De,U)){Se(B,s);continue}if(E&&typeof m=="object"&&typeof m.getAttributeType=="function"&&!Q)switch(m.getAttributeType(jn,De)){case"TrustedHTML":{U=E.createHTML(U);break}case"TrustedScriptURL":{U=E.createScriptURL(U);break}}if(U!==pr)try{Q?s.setAttributeNS(Q,B,U):s.setAttribute(B,U),gr(s)?ue(s):dn(e.removed)}catch{Se(B,s)}}fe(C.afterSanitizeAttributes,s,null)},Ba=function x(s){let h=null;const b=Fn(s);for(fe(C.beforeSanitizeShadowDOM,s,null);h=b.nextNode();)fe(C.uponSanitizeShadowNode,h,null),Hn(h),Gn(h),h.content instanceof a&&x(h.content);fe(C.afterSanitizeShadowDOM,s,null)};return e.sanitize=function(x){let s=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},h=null,b=null,M=null,W=null;if(dr=!x,dr&&(x="<!-->"),typeof x!="string"&&!Bn(x))if(typeof x.toString=="function"){if(x=x.toString(),typeof x!="string")throw Ye("dirty is not a string, aborting")}else throw Ye("toString is not a function");if(!e.isSupported)return x;if(or||cr(s),e.removed=[],typeof x=="string"&&(Qe=!1),Qe){if(x.nodeName){const me=H(x.nodeName);if(!F[me]||oe[me])throw Ye("root node is forbidden and cannot be sanitized in-place")}}else if(x instanceof d)h=On("<!---->"),b=h.ownerDocument.importNode(x,!0),b.nodeType===Xe.element&&b.nodeName==="BODY"||b.nodeName==="HTML"?h=b:h.appendChild(b);else{if(!Ne&&!Ie&&!Te&&x.indexOf("<")===-1)return E&&_t?E.createHTML(x):x;if(h=On(x),!h)return Ne?null:_t?O:""}h&&ar&&ue(h.firstChild);const B=Fn(Qe?x:h);for(;M=B.nextNode();)Hn(M),Gn(M),M.content instanceof a&&Ba(M.content);if(Qe)return x;if(Ne){if(mt)for(W=se.call(h.ownerDocument);h.firstChild;)W.appendChild(h.firstChild);else W=h;return(D.shadowroot||D.shadowrootmode)&&(W=Z.call(o,W,!0)),W}let Q=Te?h.outerHTML:h.innerHTML;return Te&&F["!doctype"]&&h.ownerDocument&&h.ownerDocument.doctype&&h.ownerDocument.doctype.name&&q(fn,h.ownerDocument.doctype.name)&&(Q="<!DOCTYPE "+h.ownerDocument.doctype.name+`>
`+Q),Ie&&gt([X,V,ne],me=>{Q=qe(Q,me," ")}),E&&_t?E.createHTML(Q):Q},e.setConfig=function(){let x=arguments.length>0&&arguments[0]!==void 0?arguments[0]:{};cr(x),or=!0},e.clearConfig=function(){ze=null,or=!1},e.isValidAttribute=function(x,s,h){ze||cr({});const b=H(x),M=H(s);return Un(b,M,h)},e.addHook=function(x,s){typeof s=="function"&&je(C[x],s)},e.removeHook=function(x,s){if(s!==void 0){const h=qo(C[x],s);return h===-1?void 0:Yo(C[x],h,1)[0]}return dn(C[x])},e.removeHooks=function(x){C[x]=[]},e.removeAllHooks=function(){C=_n()},e}var ua=bn();function ca({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"m5 12 7-7 7 7"}),g("path",{d:"M12 19V5"})]})}function xn({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:g("path",{d:"m6 9 6 6 6-6"})})}function kn({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:g("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function er({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),g("path",{d:"M5 3v4"}),g("path",{d:"M19 17v4"}),g("path",{d:"M3 5h4"}),g("path",{d:"M17 19h4"})]})}function ga({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),g("polyline",{points:"14 2 14 8 20 8"})]})}function vn({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("circle",{cx:"11",cy:"11",r:"8"}),g("path",{d:"m21 21-4.3-4.3"})]})}function yn({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"}),g("path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"}),g("path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"}),g("path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375"}),g("path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5"}),g("path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396"}),g("path",{d:"M19.938 10.5a4 4 0 0 1 .585.396"}),g("path",{d:"M6 18a4 4 0 0 1-1.967-.516"}),g("path",{d:"M19.967 17.484A4 4 0 0 1 18 18"})]})}function pa({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}),g("path",{d:"m15 5 4 4"})]})}function ha({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"M21 12h-8"}),g("path",{d:"M21 6H8"}),g("path",{d:"M21 18h-8"}),g("path",{d:"M3 6v4c0 1.1.9 2 2 2h3"}),g("path",{d:"M3 10v6c0 1.1.9 2 2 2h3"})]})}function fa({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("circle",{cx:"18",cy:"18",r:"3"}),g("circle",{cx:"6",cy:"6",r:"3"}),g("path",{d:"M6 21V9a9 9 0 0 0 9 9"})]})}function ma({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("circle",{cx:"12",cy:"12",r:"10"}),g("path",{d:"m9 12 2 2 4-4"})]})}function _a({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:g("circle",{cx:"12",cy:"12",r:"10"})})}function ba({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("circle",{cx:"12",cy:"12",r:"10"}),g("line",{x1:"12",y1:"8",x2:"12",y2:"12"}),g("line",{x1:"12",y1:"16",x2:"12.01",y2:"16"})]})}function wn({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"M12 2v4"}),g("path",{d:"m16.2 7.8 2.9-2.9"}),g("path",{d:"M18 12h4"}),g("path",{d:"m16.2 16.2 2.9 2.9"}),g("path",{d:"M12 18v4"}),g("path",{d:"m4.9 19.1 2.9-2.9"}),g("path",{d:"M2 12h4"}),g("path",{d:"m4.9 4.9 2.9 2.9"})]})}A.setOptions({breaks:!0,gfm:!0});const Tn=new A.Renderer;Tn.link=({href:t,title:e,text:r})=>{const o=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${o}>${r}</a>`},A.use({renderer:Tn});function xa(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function ka(t){if(!t)return"";let e=t;e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\(Source:[^)]*\)/gi,""),e=e.replace(/\[\d+\]/g,"");const r=A.parse(e,{async:!1});return ua.sanitize(r,{USE_PROFILES:{html:!0},ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i})}function va({message:t}){const[e,r]=ge(!1),o=t.role==="user",n=t.citations&&t.citations.length>0;return g("div",{className:`grounded-message ${t.role}`,children:[g("div",{className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:o?xa(t.content):ka(t.content)}}),t.isStreaming&&g("span",{className:"grounded-cursor"}),!o&&n&&g("div",{className:"grounded-sources",children:[g("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>r(!e),children:[g(kn,{}),t.citations.length," source",t.citations.length!==1?"s":"",g(xn,{})]}),g("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((a,i)=>{const d=a.url?.startsWith("upload://"),l=a.title||(d?"Uploaded Document":a.url)||`Source ${i+1}`;return d?g("div",{className:"grounded-source grounded-source-file",children:[g(ga,{}),g("span",{className:"grounded-source-title",children:l})]},i):g("a",{href:a.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[g(kn,{}),g("span",{className:"grounded-source-title",children:l})]},i)})})]})]})}function ya({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return g("div",{className:"grounded-status",children:g("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return g(vn,{className:"grounded-status-icon"});case"generating":return g(er,{className:"grounded-status-icon"});default:return null}})(),g("span",{className:"grounded-status-text",children:e()}),g("div",{className:"grounded-status-dots",children:[g("div",{className:"grounded-typing-dot"}),g("div",{className:"grounded-typing-dot"}),g("div",{className:"grounded-typing-dot"})]})]})})}function wa(t){switch(t){case"rewrite":return pa;case"plan":return ha;case"search":return vn;case"merge":return fa;case"generate":return er;default:return yn}}function Ta(t){switch(t){case"completed":return ma;case"in_progress":return wn;case"error":return ba;default:return _a}}function Sn({steps:t,isStreaming:e=!1,defaultOpen:r=!1}){const[o,n]=ge(r);if(t.length===0)return null;const a=t.filter(u=>u.status==="completed").length,i=t.length,d=t.some(u=>u.status==="in_progress"),l=()=>{if(e||d){const u=t.find(p=>p.status==="in_progress");return u?`${u.title}...`:"Processing..."}return a===i&&i>0?`Completed ${i} reasoning steps`:`${a}/${i} steps completed`};return g("div",{className:`grounded-reasoning-panel ${e?"streaming":""}`,children:[g("button",{className:`grounded-reasoning-trigger ${o?"open":""}`,onClick:()=>n(!o),type:"button",children:[g("div",{className:"grounded-reasoning-trigger-icon",children:g(yn,{})}),g("span",{className:"grounded-reasoning-trigger-text",children:e||d?g("span",{className:"grounded-reasoning-shimmer",children:l()}):l()}),g(xn,{className:"grounded-reasoning-chevron"})]}),o&&g("div",{className:"grounded-reasoning-content",children:g("div",{className:"grounded-reasoning-timeline",children:t.map((u,p)=>g(Sa,{step:u,isLast:p===t.length-1},u.id))})})]})}function Sa({step:t,isLast:e=!1}){const r=wa(t.type),o=Ta(t.status),n=t.status==="in_progress";return t.status,t.status,g("div",{className:`grounded-reasoning-step ${t.status} ${e?"last":""}`,children:[g("div",{className:`grounded-reasoning-step-dot ${t.status}`}),g("div",{className:`grounded-reasoning-step-icon ${t.status}`,children:g(r,{})}),g("div",{className:"grounded-reasoning-step-content",children:[g("div",{className:"grounded-reasoning-step-title",children:n?g("span",{className:"grounded-reasoning-shimmer",children:t.title}):t.title}),t.summary&&g("div",{className:`grounded-reasoning-step-summary ${t.status}`,children:t.summary})]}),g("div",{className:`grounded-reasoning-step-status ${t.status}`,children:n?g(wn,{className:"grounded-reasoning-spinner"}):g(o,{})})]})}function Aa({config:t}){const{token:e,apiBase:r,agentName:o,welcomeMessage:n,logoUrl:a,ragType:i,showReasoningSteps:d}=t,[l,u]=ge(""),p=xe(null),c=xe(null),f=i==="advanced"&&d!==!1,{messages:m,isLoading:_,isStreaming:T,chatStatus:w,currentReasoningSteps:k,sendMessage:v}=oo({token:e,apiBase:r,endpointType:"chat-endpoint"});Nt(()=>{p.current&&p.current.scrollIntoView({behavior:"smooth"})},[m,_,k]),Nt(()=>{c.current?.focus()},[]);const z=xe(!1);Nt(()=>{z.current&&!_&&setTimeout(()=>c.current?.focus(),50),z.current=_},[_]);const E=()=>{l.trim()&&!_&&(v(l),u(""),c.current&&(c.current.style.height="auto"),setTimeout(()=>c.current?.focus(),50))},O=I=>{I.key==="Enter"&&!I.shiftKey&&(I.preventDefault(),E())},K=I=>{const Z=I.target;u(Z.value),Z.style.height="auto",Z.style.height=Math.min(Z.scrollHeight,120)+"px"},ie=m.length===0&&!_,se=o.charAt(0).toUpperCase();return g("div",{className:"grounded-fullpage",children:[g("div",{className:"grounded-fullpage-header",children:[a?g("img",{src:a,alt:"",className:"grounded-fullpage-logo"}):g("div",{className:"grounded-fullpage-avatar",children:se}),g("div",{className:"grounded-fullpage-info",children:g("h1",{children:o})})]}),g("div",{className:"grounded-fullpage-messages",children:g("div",{className:"grounded-fullpage-messages-inner",children:[ie?g("div",{className:"grounded-fullpage-welcome",children:[g(er,{className:"grounded-fullpage-welcome-icon"}),g("h2",{children:n}),g("p",{children:"Ask me anything. I'm here to help."})]}):g(Ae,{children:[m.map((I,Z)=>{const V=Z===m.length-1&&I.role==="assistant"&&f&&k.length>0,ne=I.role==="user"||I.content;return g(Ae,{children:[V&&g(Sn,{steps:k,isStreaming:_||T,defaultOpen:!1}),ne&&g(va,{message:I})]},I.id)}),f&&k.length>0&&m.length>0&&m[m.length-1].role!=="assistant"&&g(Sn,{steps:k,isStreaming:_||T,defaultOpen:!1}),(_||w.status!=="idle")&&w.status!=="streaming"&&(!f||k.length===0)&&g(ya,{status:w})]}),g("div",{ref:p})]})}),g("div",{className:"grounded-fullpage-input-area",children:g("div",{className:"grounded-fullpage-input-container",children:[g("textarea",{ref:c,className:"grounded-fullpage-input",placeholder:`Ask ${o} anything...`,value:l,onInput:K,onKeyDown:O,rows:1,disabled:_}),g("button",{className:"grounded-fullpage-send",onClick:E,disabled:!l.trim()||_,"aria-label":"Send message",children:g(ca,{})})]})}),g("div",{className:"grounded-fullpage-footer",children:["Powered by ",g("a",{href:"https://github.com/grounded-ai",target:"_blank",rel:"noopener noreferrer",children:"Grounded"})]})]})}const Ea=`
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
`;function Ra(t){const{containerId:e,containerStyle:r="",colorScheme:o="auto"}=t,n=document.createElement("div");n.id=e,r&&(n.style.cssText=r),document.body.appendChild(n);const a=n.attachShadow({mode:"open"}),i=document.createElement("style");i.textContent=Ea,a.appendChild(i),Ca(n,o);let d=null,l=null;o==="auto"&&(d=window.matchMedia("(prefers-color-scheme: dark)"),l=()=>{console.log("[Grounded] System theme changed")},d.addEventListener("change",l));const u=document.createElement("div");return u.style.cssText="height:100%;width:100%;",a.appendChild(u),{container:n,shadowRoot:a,mountPoint:u,cleanup:()=>{d&&l&&d.removeEventListener("change",l),n.remove()}}}function Ca(t,e){t.classList.remove("light","dark"),e==="light"?t.classList.add("light"):e==="dark"&&t.classList.add("dark")}function La(t){if(!t||typeof t!="object")return!1;const e=t;return typeof e.token=="string"&&e.token.length>0}class Ia{constructor(){this.context=null,this.mounted=!1}init(e){if(this.mounted){console.warn("[Grounded Chat] Already initialized");return}if(!e?.token){console.error("[Grounded Chat] Token is required");return}const r=e.colorScheme||"auto";this.context=Ra({containerId:"grounded-chat-container",containerStyle:"position:fixed;inset:0;z-index:2147483647;",colorScheme:r}),Jn(g(Aa,{config:e}),this.context.mountPoint),this.mounted=!0,console.log("[Grounded Chat] Initialized with colorScheme:",r)}destroy(){this.context&&(this.context.cleanup(),this.context=null),this.mounted=!1,console.log("[Grounded Chat] Destroyed")}}const An=new Ia;function tr(t,e){if(t==="init"){if(!La(e)){console.error("[Grounded Chat] Invalid init payload");return}An.init(e)}else t==="destroy"&&An.destroy()}const Na=window.groundedChat?.q??[];for(const t of Na)tr(t[0],t[1]);return window.groundedChat=tr,yt.groundedChat=tr,Object.defineProperty(yt,Symbol.toStringTag,{value:"Module"}),yt})({});
