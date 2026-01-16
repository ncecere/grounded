var GroundedChat=(function(_e){"use strict";var ae,v,Ge,D,Qe,Ye,Ve,Xe,ke,ve,we,Q={},Ke=[],jt=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,se=Array.isArray;function q(t,e){for(var r in e)t[r]=e[r];return t}function ye(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function Dt(t,e,r){var o,n,a,s={};for(a in e)a=="key"?o=e[a]:a=="ref"?n=e[a]:s[a]=e[a];if(arguments.length>2&&(s.children=arguments.length>3?ae.call(arguments,2):r),typeof t=="function"&&t.defaultProps!=null)for(a in t.defaultProps)s[a]===void 0&&(s[a]=t.defaultProps[a]);return ie(t,s,o,n,null)}function ie(t,e,r,o,n){var a={type:t,props:e,key:r,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++Ge,__i:-1,__u:0};return n==null&&v.vnode!=null&&v.vnode(a),a}function Y(t){return t.children}function le(t,e){this.props=t,this.context=e}function O(t,e){if(e==null)return t.__?O(t.__,t.__i+1):null;for(var r;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null)return r.__e;return typeof t.type=="function"?O(t):null}function Je(t){var e,r;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null){t.__e=t.__c.base=r.__e;break}return Je(t)}}function et(t){(!t.__d&&(t.__d=!0)&&D.push(t)&&!de.__r++||Qe!=v.debounceRendering)&&((Qe=v.debounceRendering)||Ye)(de)}function de(){for(var t,e,r,o,n,a,s,d=1;D.length;)D.length>d&&D.sort(Ve),t=D.shift(),d=D.length,t.__d&&(r=void 0,o=void 0,n=(o=(e=t).__v).__e,a=[],s=[],e.__P&&((r=q({},o)).__v=o.__v+1,v.vnode&&v.vnode(r),Se(e.__P,r,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,a,n??O(o),!!(32&o.__u),s),r.__v=o.__v,r.__.__k[r.__i]=r,at(a,r,s),o.__e=o.__=null,r.__e!=n&&Je(r)));de.__r=0}function tt(t,e,r,o,n,a,s,d,i,u,c){var l,g,p,f,_,y,k,m=o&&o.__k||Ke,A=e.length;for(i=Ut(r,e,m,i,A),l=0;l<A;l++)(p=r.__k[l])!=null&&(g=p.__i==-1?Q:m[p.__i]||Q,p.__i=l,y=Se(t,p,g,n,a,s,d,i,u,c),f=p.__e,p.ref&&g.ref!=p.ref&&(g.ref&&ze(g.ref,null,p),c.push(p.ref,p.__c||f,p)),_==null&&f!=null&&(_=f),(k=!!(4&p.__u))||g.__k===p.__k?i=rt(p,i,t,k):typeof p.type=="function"&&y!==void 0?i=y:f&&(i=f.nextSibling),p.__u&=-7);return r.__e=_,i}function Ut(t,e,r,o,n){var a,s,d,i,u,c=r.length,l=c,g=0;for(t.__k=new Array(n),a=0;a<n;a++)(s=e[a])!=null&&typeof s!="boolean"&&typeof s!="function"?(typeof s=="string"||typeof s=="number"||typeof s=="bigint"||s.constructor==String?s=t.__k[a]=ie(null,s,null,null,null):se(s)?s=t.__k[a]=ie(Y,{children:s},null,null,null):s.constructor===void 0&&s.__b>0?s=t.__k[a]=ie(s.type,s.props,s.key,s.ref?s.ref:null,s.__v):t.__k[a]=s,i=a+g,s.__=t,s.__b=t.__b+1,d=null,(u=s.__i=Wt(s,r,i,l))!=-1&&(l--,(d=r[u])&&(d.__u|=2)),d==null||d.__v==null?(u==-1&&(n>c?g--:n<c&&g++),typeof s.type!="function"&&(s.__u|=4)):u!=i&&(u==i-1?g--:u==i+1?g++:(u>i?g--:g++,s.__u|=4))):t.__k[a]=null;if(l)for(a=0;a<c;a++)(d=r[a])!=null&&(2&d.__u)==0&&(d.__e==o&&(o=O(d)),it(d,d));return o}function rt(t,e,r,o){var n,a;if(typeof t.type=="function"){for(n=t.__k,a=0;n&&a<n.length;a++)n[a]&&(n[a].__=t,e=rt(n[a],e,r,o));return e}t.__e!=e&&(o&&(e&&t.type&&!e.parentNode&&(e=O(t)),r.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function Wt(t,e,r,o){var n,a,s,d=t.key,i=t.type,u=e[r],c=u!=null&&(2&u.__u)==0;if(u===null&&d==null||c&&d==u.key&&i==u.type)return r;if(o>(c?1:0)){for(n=r-1,a=r+1;n>=0||a<e.length;)if((u=e[s=n>=0?n--:a++])!=null&&(2&u.__u)==0&&d==u.key&&i==u.type)return s}return-1}function nt(t,e,r){e[0]=="-"?t.setProperty(e,r??""):t[e]=r==null?"":typeof r!="number"||jt.test(e)?r:r+"px"}function ue(t,e,r,o,n){var a,s;e:if(e=="style")if(typeof r=="string")t.style.cssText=r;else{if(typeof o=="string"&&(t.style.cssText=o=""),o)for(e in o)r&&e in r||nt(t.style,e,"");if(r)for(e in r)o&&r[e]==o[e]||nt(t.style,e,r[e])}else if(e[0]=="o"&&e[1]=="n")a=e!=(e=e.replace(Xe,"$1")),s=e.toLowerCase(),e=s in t||e=="onFocusOut"||e=="onFocusIn"?s.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+a]=r,r?o?r.u=o.u:(r.u=ke,t.addEventListener(e,a?we:ve,a)):t.removeEventListener(e,a?we:ve,a);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&r==1?"":r))}}function ot(t){return function(e){if(this.l){var r=this.l[e.type+t];if(e.t==null)e.t=ke++;else if(e.t<r.u)return;return r(v.event?v.event(e):e)}}}function Se(t,e,r,o,n,a,s,d,i,u){var c,l,g,p,f,_,y,k,m,A,w,T,C,F,N,L,E,I=e.type;if(e.constructor!==void 0)return null;128&r.__u&&(i=!!(32&r.__u),a=[d=e.__e=r.__e]),(c=v.__b)&&c(e);e:if(typeof I=="function")try{if(k=e.props,m="prototype"in I&&I.prototype.render,A=(c=I.contextType)&&o[c.__c],w=c?A?A.props.value:c.__:o,r.__c?y=(l=e.__c=r.__c).__=l.__E:(m?e.__c=l=new I(k,w):(e.__c=l=new le(k,w),l.constructor=I,l.render=Ot),A&&A.sub(l),l.state||(l.state={}),l.__n=o,g=l.__d=!0,l.__h=[],l._sb=[]),m&&l.__s==null&&(l.__s=l.state),m&&I.getDerivedStateFromProps!=null&&(l.__s==l.state&&(l.__s=q({},l.__s)),q(l.__s,I.getDerivedStateFromProps(k,l.__s))),p=l.props,f=l.state,l.__v=e,g)m&&I.getDerivedStateFromProps==null&&l.componentWillMount!=null&&l.componentWillMount(),m&&l.componentDidMount!=null&&l.__h.push(l.componentDidMount);else{if(m&&I.getDerivedStateFromProps==null&&k!==p&&l.componentWillReceiveProps!=null&&l.componentWillReceiveProps(k,w),e.__v==r.__v||!l.__e&&l.shouldComponentUpdate!=null&&l.shouldComponentUpdate(k,l.__s,w)===!1){for(e.__v!=r.__v&&(l.props=k,l.state=l.__s,l.__d=!1),e.__e=r.__e,e.__k=r.__k,e.__k.some(function(M){M&&(M.__=e)}),T=0;T<l._sb.length;T++)l.__h.push(l._sb[T]);l._sb=[],l.__h.length&&s.push(l);break e}l.componentWillUpdate!=null&&l.componentWillUpdate(k,l.__s,w),m&&l.componentDidUpdate!=null&&l.__h.push(function(){l.componentDidUpdate(p,f,_)})}if(l.context=w,l.props=k,l.__P=t,l.__e=!1,C=v.__r,F=0,m){for(l.state=l.__s,l.__d=!1,C&&C(e),c=l.render(l.props,l.state,l.context),N=0;N<l._sb.length;N++)l.__h.push(l._sb[N]);l._sb=[]}else do l.__d=!1,C&&C(e),c=l.render(l.props,l.state,l.context),l.state=l.__s;while(l.__d&&++F<25);l.state=l.__s,l.getChildContext!=null&&(o=q(q({},o),l.getChildContext())),m&&!g&&l.getSnapshotBeforeUpdate!=null&&(_=l.getSnapshotBeforeUpdate(p,f)),L=c,c!=null&&c.type===Y&&c.key==null&&(L=st(c.props.children)),d=tt(t,se(L)?L:[L],e,r,o,n,a,s,d,i,u),l.base=e.__e,e.__u&=-161,l.__h.length&&s.push(l),y&&(l.__E=l.__=null)}catch(M){if(e.__v=null,i||a!=null)if(M.then){for(e.__u|=i?160:128;d&&d.nodeType==8&&d.nextSibling;)d=d.nextSibling;a[a.indexOf(d)]=null,e.__e=d}else{for(E=a.length;E--;)ye(a[E]);$e(e)}else e.__e=r.__e,e.__k=r.__k,M.then||$e(e);v.__e(M,e,r)}else a==null&&e.__v==r.__v?(e.__k=r.__k,e.__e=r.__e):d=e.__e=Zt(r.__e,e,r,o,n,a,s,i,u);return(c=v.diffed)&&c(e),128&e.__u?void 0:d}function $e(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach($e)}function at(t,e,r){for(var o=0;o<r.length;o++)ze(r[o],r[++o],r[++o]);v.__c&&v.__c(e,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(a){a.call(n)})}catch(a){v.__e(a,n.__v)}})}function st(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:se(t)?t.map(st):q({},t)}function Zt(t,e,r,o,n,a,s,d,i){var u,c,l,g,p,f,_,y=r.props||Q,k=e.props,m=e.type;if(m=="svg"?n="http://www.w3.org/2000/svg":m=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),a!=null){for(u=0;u<a.length;u++)if((p=a[u])&&"setAttribute"in p==!!m&&(m?p.localName==m:p.nodeType==3)){t=p,a[u]=null;break}}if(t==null){if(m==null)return document.createTextNode(k);t=document.createElementNS(n,m,k.is&&k),d&&(v.__m&&v.__m(e,a),d=!1),a=null}if(m==null)y===k||d&&t.data==k||(t.data=k);else{if(a=a&&ae.call(t.childNodes),!d&&a!=null)for(y={},u=0;u<t.attributes.length;u++)y[(p=t.attributes[u]).name]=p.value;for(u in y)if(p=y[u],u!="children"){if(u=="dangerouslySetInnerHTML")l=p;else if(!(u in k)){if(u=="value"&&"defaultValue"in k||u=="checked"&&"defaultChecked"in k)continue;ue(t,u,null,p,n)}}for(u in k)p=k[u],u=="children"?g=p:u=="dangerouslySetInnerHTML"?c=p:u=="value"?f=p:u=="checked"?_=p:d&&typeof p!="function"||y[u]===p||ue(t,u,p,y[u],n);if(c)d||l&&(c.__html==l.__html||c.__html==t.innerHTML)||(t.innerHTML=c.__html),e.__k=[];else if(l&&(t.innerHTML=""),tt(e.type=="template"?t.content:t,se(g)?g:[g],e,r,o,m=="foreignObject"?"http://www.w3.org/1999/xhtml":n,a,s,a?a[0]:r.__k&&O(r,0),d,i),a!=null)for(u=a.length;u--;)ye(a[u]);d||(u="value",m=="progress"&&f==null?t.removeAttribute("value"):f!=null&&(f!==t[u]||m=="progress"&&!f||m=="option"&&f!=y[u])&&ue(t,u,f,y[u],n),u="checked",_!=null&&_!=t[u]&&ue(t,u,_,y[u],n))}return t}function ze(t,e,r){try{if(typeof t=="function"){var o=typeof t.__u=="function";o&&t.__u(),o&&e==null||(t.__u=t(e))}else t.current=e}catch(n){v.__e(n,r)}}function it(t,e,r){var o,n;if(v.unmount&&v.unmount(t),(o=t.ref)&&(o.current&&o.current!=t.__e||ze(o,null,e)),(o=t.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(a){v.__e(a,e)}o.base=o.__P=null}if(o=t.__k)for(n=0;n<o.length;n++)o[n]&&it(o[n],e,r||typeof t.type!="function");r||ye(t.__e),t.__c=t.__=t.__e=void 0}function Ot(t,e,r){return this.constructor(t,r)}function Gt(t,e,r){var o,n,a,s;e==document&&(e=document.documentElement),v.__&&v.__(t,e),n=(o=!1)?null:e.__k,a=[],s=[],Se(e,t=e.__k=Dt(Y,null,[t]),n||Q,Q,e.namespaceURI,n?null:e.firstChild?ae.call(e.childNodes):null,a,n?n.__e:e.firstChild,o,s),at(a,t,s)}ae=Ke.slice,v={__e:function(t,e,r,o){for(var n,a,s;e=e.__;)if((n=e.__c)&&!n.__)try{if((a=n.constructor)&&a.getDerivedStateFromError!=null&&(n.setState(a.getDerivedStateFromError(t)),s=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(t,o||{}),s=n.__d),s)return n.__E=n}catch(d){t=d}throw t}},Ge=0,le.prototype.setState=function(t,e){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=q({},this.state),typeof t=="function"&&(t=t(q({},r),this.props)),t&&q(r,t),t!=null&&this.__v&&(e&&this._sb.push(e),et(this))},le.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),et(this))},le.prototype.render=Y,D=[],Ye=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,Ve=function(t,e){return t.__v.__b-e.__v.__b},de.__r=0,Xe=/(PointerCapture)$|Capture$/i,ke=0,ve=ot(!1),we=ot(!0);var Qt=0;function h(t,e,r,o,n,a){e||(e={});var s,d,i=e;if("ref"in i)for(d in i={},e)d=="ref"?s=e[d]:i[d]=e[d];var u={type:t,props:i,key:r,ref:s,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--Qt,__i:-1,__u:0,__source:n,__self:a};if(typeof t=="function"&&(s=t.defaultProps))for(d in s)i[d]===void 0&&(i[d]=s[d]);return v.vnode&&v.vnode(u),u}var V,S,Te,lt,X=0,dt=[],$=v,ut=$.__b,ct=$.__r,gt=$.diffed,pt=$.__c,ht=$.unmount,ft=$.__;function Re(t,e){$.__h&&$.__h(S,t,X||e),X=0;var r=S.__H||(S.__H={__:[],__h:[]});return t>=r.__.length&&r.__.push({}),r.__[t]}function U(t){return X=1,Yt(_t,t)}function Yt(t,e,r){var o=Re(V++,2);if(o.t=t,!o.__c&&(o.__=[_t(void 0,e),function(d){var i=o.__N?o.__N[0]:o.__[0],u=o.t(i,d);i!==u&&(o.__N=[u,o.__[1]],o.__c.setState({}))}],o.__c=S,!S.__f)){var n=function(d,i,u){if(!o.__c.__H)return!0;var c=o.__c.__H.__.filter(function(g){return!!g.__c});if(c.every(function(g){return!g.__N}))return!a||a.call(this,d,i,u);var l=o.__c.props!==d;return c.forEach(function(g){if(g.__N){var p=g.__[0];g.__=g.__N,g.__N=void 0,p!==g.__[0]&&(l=!0)}}),a&&a.call(this,d,i,u)||l};S.__f=!0;var a=S.shouldComponentUpdate,s=S.componentWillUpdate;S.componentWillUpdate=function(d,i,u){if(this.__e){var c=a;a=void 0,n(d,i,u),a=c}s&&s.call(this,d,i,u)},S.shouldComponentUpdate=n}return o.__N||o.__}function Ae(t,e){var r=Re(V++,3);!$.__s&&xt(r.__H,e)&&(r.__=t,r.u=e,S.__H.__h.push(r))}function G(t){return X=5,mt(function(){return{current:t}},[])}function mt(t,e){var r=Re(V++,7);return xt(r.__H,e)&&(r.__=t(),r.__H=e,r.__h=t),r.__}function Ce(t,e){return X=8,mt(function(){return t},e)}function Vt(){for(var t;t=dt.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(ce),t.__H.__h.forEach(Ee),t.__H.__h=[]}catch(e){t.__H.__h=[],$.__e(e,t.__v)}}$.__b=function(t){S=null,ut&&ut(t)},$.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),ft&&ft(t,e)},$.__r=function(t){ct&&ct(t),V=0;var e=(S=t.__c).__H;e&&(Te===S?(e.__h=[],S.__h=[],e.__.forEach(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(e.__h.forEach(ce),e.__h.forEach(Ee),e.__h=[],V=0)),Te=S},$.diffed=function(t){gt&&gt(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(dt.push(e)!==1&&lt===$.requestAnimationFrame||((lt=$.requestAnimationFrame)||Xt)(Vt)),e.__H.__.forEach(function(r){r.u&&(r.__H=r.u),r.u=void 0})),Te=S=null},$.__c=function(t,e){e.some(function(r){try{r.__h.forEach(ce),r.__h=r.__h.filter(function(o){return!o.__||Ee(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],$.__e(o,r.__v)}}),pt&&pt(t,e)},$.unmount=function(t){ht&&ht(t);var e,r=t.__c;r&&r.__H&&(r.__H.__.forEach(function(o){try{ce(o)}catch(n){e=n}}),r.__H=void 0,e&&$.__e(e,r.__v))};var bt=typeof requestAnimationFrame=="function";function Xt(t){var e,r=function(){clearTimeout(o),bt&&cancelAnimationFrame(e),setTimeout(t)},o=setTimeout(r,35);bt&&(e=requestAnimationFrame(r))}function ce(t){var e=S,r=t.__c;typeof r=="function"&&(t.__c=void 0,r()),S=e}function Ee(t){var e=S;t.__c=t.__(),S=e}function xt(t,e){return!t||t.length!==e.length||e.some(function(r,o){return r!==t[o]})}function _t(t,e){return typeof e=="function"?e(t):e}function Kt({token:t,apiBase:e,endpointType:r="widget"}){const[o,n]=U([]),[a,s]=U(!1),[d,i]=U(!1),[u,c]=U(null),[l,g]=U({status:"idle"}),p=G(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),f=G(null),_=G(null),y=()=>Math.random().toString(36).slice(2,11),k=Ce(async w=>{if(!w.trim()||a||d)return;const T={id:y(),role:"user",content:w.trim(),timestamp:Date.now()},C=y();n(F=>[...F,T]),s(!0),i(!0),c(null),g({status:"searching",message:"Searching knowledge base..."}),_.current=null,f.current=new AbortController;try{const F={message:w.trim()};p.current&&(F.conversationId=p.current);const N=r==="chat-endpoint"?`${e}/api/v1/c/${t}/chat/stream`:`${e}/api/v1/widget/${t}/chat/stream`,L=await fetch(N,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(F),signal:f.current.signal});if(!L.ok){const ne=await L.json().catch(()=>({}));throw new Error(ne.message||`Request failed: ${L.status}`)}n(ne=>[...ne,{id:C,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),s(!1);const E=L.body?.getReader();if(!E)throw new Error("No response body");const I=new TextDecoder;let M="",xe="";for(;;){const{done:ne,value:Yr}=await E.read();if(ne)break;M+=I.decode(Yr,{stream:!0});const qt=M.split(`
`);M=qt.pop()||"";for(const Ue of qt)if(Ue.startsWith("data: "))try{const z=JSON.parse(Ue.slice(6));if(z.type==="status"){const H=z.status==="searching"?"searching":z.status==="generating"?"generating":"searching";g({status:H,message:z.message,sourcesCount:z.sourcesCount})}else if(z.type==="sources"&&z.sources)_.current=z.sources.map(H=>({index:H.index,title:H.title,url:H.url,snippet:H.snippet}));else if(z.type==="text"&&z.content)xe||g({status:"streaming"}),xe+=z.content,n(H=>H.map(oe=>oe.id===C?{...oe,content:xe}:oe));else if(z.type==="done"){if(z.conversationId){p.current=z.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,z.conversationId)}catch{}}const H=_.current?[..._.current]:[];_.current=null,n(oe=>oe.map(We=>We.id===C?{...We,content:xe,isStreaming:!1,citations:H}:We)),g({status:"idle"})}else if(z.type==="error")throw new Error(z.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",Ue)}}}catch(F){if(F.name==="AbortError"){g({status:"idle"});return}g({status:"idle"}),c(F instanceof Error?F.message:"An error occurred"),n(N=>N.some(E=>E.id===C)?N.map(E=>E.id===C?{...E,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:E):[...N,{id:C,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{s(!1),i(!1),f.current=null}},[t,e,a,d]),m=Ce(()=>{f.current&&(f.current.abort(),f.current=null),i(!1),s(!1)},[]),A=Ce(()=>{n([]),p.current=null;try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:o,isLoading:a,isStreaming:d,error:u,chatStatus:l,sendMessage:k,stopStreaming:m,clearMessages:A}}function Ie(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var W=Ie();function kt(t){W=t}var K={exec:()=>null};function b(t,e=""){let r=typeof t=="string"?t:t.source,o={replace:(n,a)=>{let s=typeof a=="string"?a:a.source;return s=s.replace(R.caret,"$1"),r=r.replace(n,s),o},getRegex:()=>new RegExp(r,e)};return o}var Jt=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),R={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},er=/^(?:[ \t]*(?:\n|$))+/,tr=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,rr=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,J=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,nr=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Pe=/(?:[*+-]|\d{1,9}[.)])/,vt=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,wt=b(vt).replace(/bull/g,Pe).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),or=b(vt).replace(/bull/g,Pe).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Be=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,ar=/^[^\n]+/,Fe=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,sr=b(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",Fe).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),ir=b(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Pe).getRegex(),ge="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Le=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,lr=b("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",Le).replace("tag",ge).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),yt=b(Be).replace("hr",J).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ge).getRegex(),dr=b(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",yt).getRegex(),Ne={blockquote:dr,code:tr,def:sr,fences:rr,heading:nr,hr:J,html:lr,lheading:wt,list:ir,newline:er,paragraph:yt,table:K,text:ar},St=b("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",J).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ge).getRegex(),ur={...Ne,lheading:or,table:St,paragraph:b(Be).replace("hr",J).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",St).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ge).getRegex()},cr={...Ne,html:b(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",Le).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:K,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:b(Be).replace("hr",J).replace("heading",` *#{1,6} *[^
]`).replace("lheading",wt).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},gr=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,pr=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,$t=/^( {2,}|\\)\n(?!\s*$)/,hr=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,pe=/[\p{P}\p{S}]/u,Me=/[\s\p{P}\p{S}]/u,zt=/[^\s\p{P}\p{S}]/u,fr=b(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Me).getRegex(),Tt=/(?!~)[\p{P}\p{S}]/u,mr=/(?!~)[\s\p{P}\p{S}]/u,br=/(?:[^\s\p{P}\p{S}]|~)/u,xr=b(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",Jt?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Rt=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,_r=b(Rt,"u").replace(/punct/g,pe).getRegex(),kr=b(Rt,"u").replace(/punct/g,Tt).getRegex(),At="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",vr=b(At,"gu").replace(/notPunctSpace/g,zt).replace(/punctSpace/g,Me).replace(/punct/g,pe).getRegex(),wr=b(At,"gu").replace(/notPunctSpace/g,br).replace(/punctSpace/g,mr).replace(/punct/g,Tt).getRegex(),yr=b("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,zt).replace(/punctSpace/g,Me).replace(/punct/g,pe).getRegex(),Sr=b(/\\(punct)/,"gu").replace(/punct/g,pe).getRegex(),$r=b(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),zr=b(Le).replace("(?:-->|$)","-->").getRegex(),Tr=b("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",zr).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),he=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,Rr=b(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",he).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Ct=b(/^!?\[(label)\]\[(ref)\]/).replace("label",he).replace("ref",Fe).getRegex(),Et=b(/^!?\[(ref)\](?:\[\])?/).replace("ref",Fe).getRegex(),Ar=b("reflink|nolink(?!\\()","g").replace("reflink",Ct).replace("nolink",Et).getRegex(),It=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,He={_backpedal:K,anyPunctuation:Sr,autolink:$r,blockSkip:xr,br:$t,code:pr,del:K,emStrongLDelim:_r,emStrongRDelimAst:vr,emStrongRDelimUnd:yr,escape:gr,link:Rr,nolink:Et,punctuation:fr,reflink:Ct,reflinkSearch:Ar,tag:Tr,text:hr,url:K},Cr={...He,link:b(/^!?\[(label)\]\((.*?)\)/).replace("label",he).getRegex(),reflink:b(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",he).getRegex()},qe={...He,emStrongRDelimAst:wr,emStrongLDelim:kr,url:b(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",It).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:b(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",It).getRegex()},Er={...qe,br:b($t).replace("{2,}","*").getRegex(),text:b(qe.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},fe={normal:Ne,gfm:ur,pedantic:cr},ee={normal:He,gfm:qe,breaks:Er,pedantic:Cr},Ir={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Pt=t=>Ir[t];function j(t,e){if(e){if(R.escapeTest.test(t))return t.replace(R.escapeReplace,Pt)}else if(R.escapeTestNoEncode.test(t))return t.replace(R.escapeReplaceNoEncode,Pt);return t}function Bt(t){try{t=encodeURI(t).replace(R.percentDecode,"%")}catch{return null}return t}function Ft(t,e){let r=t.replace(R.findPipe,(a,s,d)=>{let i=!1,u=s;for(;--u>=0&&d[u]==="\\";)i=!i;return i?"|":" |"}),o=r.split(R.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(R.slashPipe,"|");return o}function te(t,e,r){let o=t.length;if(o===0)return"";let n=0;for(;n<o&&t.charAt(o-n-1)===e;)n++;return t.slice(0,o-n)}function Pr(t,e){if(t.indexOf(e[1])===-1)return-1;let r=0;for(let o=0;o<t.length;o++)if(t[o]==="\\")o++;else if(t[o]===e[0])r++;else if(t[o]===e[1]&&(r--,r<0))return o;return r>0?-2:-1}function Lt(t,e,r,o,n){let a=e.href,s=e.title||null,d=t[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let i={type:t[0].charAt(0)==="!"?"image":"link",raw:r,href:a,title:s,text:d,tokens:o.inlineTokens(d)};return o.state.inLink=!1,i}function Br(t,e,r){let o=t.match(r.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(a=>{let s=a.match(r.other.beginningSpace);if(s===null)return a;let[d]=s;return d.length>=n.length?a.slice(n.length):a}).join(`
`)}var me=class{options;rules;lexer;constructor(t){this.options=t||W}space(t){let e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){let e=this.rules.block.code.exec(t);if(e){let r=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?r:te(r,`
`)}}}fences(t){let e=this.rules.block.fences.exec(t);if(e){let r=e[0],o=Br(r,e[3]||"",this.rules);return{type:"code",raw:r,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(t){let e=this.rules.block.heading.exec(t);if(e){let r=e[2].trim();if(this.rules.other.endingHash.test(r)){let o=te(r,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(r=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:r,tokens:this.lexer.inline(r)}}}hr(t){let e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:te(e[0],`
`)}}blockquote(t){let e=this.rules.block.blockquote.exec(t);if(e){let r=te(e[0],`
`).split(`
`),o="",n="",a=[];for(;r.length>0;){let s=!1,d=[],i;for(i=0;i<r.length;i++)if(this.rules.other.blockquoteStart.test(r[i]))d.push(r[i]),s=!0;else if(!s)d.push(r[i]);else break;r=r.slice(i);let u=d.join(`
`),c=u.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${u}`:u,n=n?`${n}
${c}`:c;let l=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(c,a,!0),this.lexer.state.top=l,r.length===0)break;let g=a.at(-1);if(g?.type==="code")break;if(g?.type==="blockquote"){let p=g,f=p.raw+`
`+r.join(`
`),_=this.blockquote(f);a[a.length-1]=_,o=o.substring(0,o.length-p.raw.length)+_.raw,n=n.substring(0,n.length-p.text.length)+_.text;break}else if(g?.type==="list"){let p=g,f=p.raw+`
`+r.join(`
`),_=this.list(f);a[a.length-1]=_,o=o.substring(0,o.length-g.raw.length)+_.raw,n=n.substring(0,n.length-p.raw.length)+_.raw,r=f.substring(a.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:a,text:n}}}list(t){let e=this.rules.block.list.exec(t);if(e){let r=e[1].trim(),o=r.length>1,n={type:"list",raw:"",ordered:o,start:o?+r.slice(0,-1):"",loose:!1,items:[]};r=o?`\\d{1,9}\\${r.slice(-1)}`:`\\${r}`,this.options.pedantic&&(r=o?r:"[*+-]");let a=this.rules.other.listItemRegex(r),s=!1;for(;t;){let i=!1,u="",c="";if(!(e=a.exec(t))||this.rules.block.hr.test(t))break;u=e[0],t=t.substring(u.length);let l=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,_=>" ".repeat(3*_.length)),g=t.split(`
`,1)[0],p=!l.trim(),f=0;if(this.options.pedantic?(f=2,c=l.trimStart()):p?f=e[1].length+1:(f=e[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,c=l.slice(f),f+=e[1].length),p&&this.rules.other.blankLine.test(g)&&(u+=g+`
`,t=t.substring(g.length+1),i=!0),!i){let _=this.rules.other.nextBulletRegex(f),y=this.rules.other.hrRegex(f),k=this.rules.other.fencesBeginRegex(f),m=this.rules.other.headingBeginRegex(f),A=this.rules.other.htmlBeginRegex(f);for(;t;){let w=t.split(`
`,1)[0],T;if(g=w,this.options.pedantic?(g=g.replace(this.rules.other.listReplaceNesting,"  "),T=g):T=g.replace(this.rules.other.tabCharGlobal,"    "),k.test(g)||m.test(g)||A.test(g)||_.test(g)||y.test(g))break;if(T.search(this.rules.other.nonSpaceChar)>=f||!g.trim())c+=`
`+T.slice(f);else{if(p||l.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||k.test(l)||m.test(l)||y.test(l))break;c+=`
`+g}!p&&!g.trim()&&(p=!0),u+=w+`
`,t=t.substring(w.length+1),l=T.slice(f)}}n.loose||(s?n.loose=!0:this.rules.other.doubleBlankLine.test(u)&&(s=!0)),n.items.push({type:"list_item",raw:u,task:!!this.options.gfm&&this.rules.other.listIsTask.test(c),loose:!1,text:c,tokens:[]}),n.raw+=u}let d=n.items.at(-1);if(d)d.raw=d.raw.trimEnd(),d.text=d.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let i of n.items){if(this.lexer.state.top=!1,i.tokens=this.lexer.blockTokens(i.text,[]),i.task){if(i.text=i.text.replace(this.rules.other.listReplaceTask,""),i.tokens[0]?.type==="text"||i.tokens[0]?.type==="paragraph"){i.tokens[0].raw=i.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),i.tokens[0].text=i.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let c=this.lexer.inlineQueue.length-1;c>=0;c--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[c].src)){this.lexer.inlineQueue[c].src=this.lexer.inlineQueue[c].src.replace(this.rules.other.listReplaceTask,"");break}}let u=this.rules.other.listTaskCheckbox.exec(i.raw);if(u){let c={type:"checkbox",raw:u[0]+" ",checked:u[0]!=="[ ]"};i.checked=c.checked,n.loose?i.tokens[0]&&["paragraph","text"].includes(i.tokens[0].type)&&"tokens"in i.tokens[0]&&i.tokens[0].tokens?(i.tokens[0].raw=c.raw+i.tokens[0].raw,i.tokens[0].text=c.raw+i.tokens[0].text,i.tokens[0].tokens.unshift(c)):i.tokens.unshift({type:"paragraph",raw:c.raw,text:c.raw,tokens:[c]}):i.tokens.unshift(c)}}if(!n.loose){let u=i.tokens.filter(l=>l.type==="space"),c=u.length>0&&u.some(l=>this.rules.other.anyLine.test(l.raw));n.loose=c}}if(n.loose)for(let i of n.items){i.loose=!0;for(let u of i.tokens)u.type==="text"&&(u.type="paragraph")}return n}}html(t){let e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){let e=this.rules.block.def.exec(t);if(e){let r=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:r,raw:e[0],href:o,title:n}}}table(t){let e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let r=Ft(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],a={type:"table",raw:e[0],header:[],align:[],rows:[]};if(r.length===o.length){for(let s of o)this.rules.other.tableAlignRight.test(s)?a.align.push("right"):this.rules.other.tableAlignCenter.test(s)?a.align.push("center"):this.rules.other.tableAlignLeft.test(s)?a.align.push("left"):a.align.push(null);for(let s=0;s<r.length;s++)a.header.push({text:r[s],tokens:this.lexer.inline(r[s]),header:!0,align:a.align[s]});for(let s of n)a.rows.push(Ft(s,a.header.length).map((d,i)=>({text:d,tokens:this.lexer.inline(d),header:!1,align:a.align[i]})));return a}}lheading(t){let e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){let e=this.rules.block.paragraph.exec(t);if(e){let r=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:r,tokens:this.lexer.inline(r)}}}text(t){let e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){let e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){let e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){let e=this.rules.inline.link.exec(t);if(e){let r=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let a=te(r.slice(0,-1),"\\");if((r.length-a.length)%2===0)return}else{let a=Pr(e[2],"()");if(a===-2)return;if(a>-1){let s=(e[0].indexOf("!")===0?5:4)+e[1].length+a;e[2]=e[2].substring(0,a),e[0]=e[0].substring(0,s).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(o);a&&(o=a[1],n=a[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?o=o.slice(1):o=o.slice(1,-1)),Lt(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let r;if((r=this.rules.inline.reflink.exec(t))||(r=this.rules.inline.nolink.exec(t))){let o=(r[2]||r[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let a=r[0].charAt(0);return{type:"text",raw:a,text:a}}return Lt(r,n,r[0],this.lexer,this.rules)}}emStrong(t,e,r=""){let o=this.rules.inline.emStrongLDelim.exec(t);if(!(!o||o[3]&&r.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!r||this.rules.inline.punctuation.exec(r))){let n=[...o[0]].length-1,a,s,d=n,i=0,u=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(u.lastIndex=0,e=e.slice(-1*t.length+n);(o=u.exec(e))!=null;){if(a=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!a)continue;if(s=[...a].length,o[3]||o[4]){d+=s;continue}else if((o[5]||o[6])&&n%3&&!((n+s)%3)){i+=s;continue}if(d-=s,d>0)continue;s=Math.min(s,s+d+i);let c=[...o[0]][0].length,l=t.slice(0,n+o.index+c+s);if(Math.min(n,s)%2){let p=l.slice(1,-1);return{type:"em",raw:l,text:p,tokens:this.lexer.inlineTokens(p)}}let g=l.slice(2,-2);return{type:"strong",raw:l,text:g,tokens:this.lexer.inlineTokens(g)}}}}codespan(t){let e=this.rules.inline.code.exec(t);if(e){let r=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(r),n=this.rules.other.startingSpaceChar.test(r)&&this.rules.other.endingSpaceChar.test(r);return o&&n&&(r=r.substring(1,r.length-1)),{type:"codespan",raw:e[0],text:r}}}br(t){let e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){let e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){let e=this.rules.inline.autolink.exec(t);if(e){let r,o;return e[2]==="@"?(r=e[1],o="mailto:"+r):(r=e[1],o=r),{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}url(t){let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){let e=this.rules.inline.text.exec(t);if(e){let r=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:r}}}},P=class Ze{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||W,this.options.tokenizer=this.options.tokenizer||new me,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let r={other:R,block:fe.normal,inline:ee.normal};this.options.pedantic?(r.block=fe.pedantic,r.inline=ee.pedantic):this.options.gfm&&(r.block=fe.gfm,this.options.breaks?r.inline=ee.breaks:r.inline=ee.gfm),this.tokenizer.rules=r}static get rules(){return{block:fe,inline:ee}}static lex(e,r){return new Ze(r).lex(e)}static lexInline(e,r){return new Ze(r).inlineTokens(e)}lex(e){e=e.replace(R.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let r=0;r<this.inlineQueue.length;r++){let o=this.inlineQueue[r];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,r=[],o=!1){for(this.options.pedantic&&(e=e.replace(R.tabCharGlobal,"    ").replace(R.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(s=>(n=s.call({lexer:this},e,r))?(e=e.substring(n.raw.length),r.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let s=r.at(-1);n.raw.length===1&&s!==void 0?s.raw+=`
`:r.push(n);continue}if(n=this.tokenizer.code(e)){e=e.substring(n.raw.length);let s=r.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.at(-1).src=s.text):r.push(n);continue}if(n=this.tokenizer.fences(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.heading(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.hr(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.blockquote(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.list(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.html(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.def(e)){e=e.substring(n.raw.length);let s=r.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.raw,this.inlineQueue.at(-1).src=s.text):this.tokens.links[n.tag]||(this.tokens.links[n.tag]={href:n.href,title:n.title},r.push(n));continue}if(n=this.tokenizer.table(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.lheading(e)){e=e.substring(n.raw.length),r.push(n);continue}let a=e;if(this.options.extensions?.startBlock){let s=1/0,d=e.slice(1),i;this.options.extensions.startBlock.forEach(u=>{i=u.call({lexer:this},d),typeof i=="number"&&i>=0&&(s=Math.min(s,i))}),s<1/0&&s>=0&&(a=e.substring(0,s+1))}if(this.state.top&&(n=this.tokenizer.paragraph(a))){let s=r.at(-1);o&&s?.type==="paragraph"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):r.push(n),o=a.length!==e.length,e=e.substring(n.raw.length);continue}if(n=this.tokenizer.text(e)){e=e.substring(n.raw.length);let s=r.at(-1);s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):r.push(n);continue}if(e){let s="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(s);break}else throw new Error(s)}}return this.state.top=!0,r}inline(e,r=[]){return this.inlineQueue.push({src:e,tokens:r}),r}inlineTokens(e,r=[]){let o=e,n=null;if(this.tokens.links){let i=Object.keys(this.tokens.links);if(i.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)i.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)a=n[2]?n[2].length:0,o=o.slice(0,n.index+a)+"["+"a".repeat(n[0].length-a-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let s=!1,d="";for(;e;){s||(d=""),s=!1;let i;if(this.options.extensions?.inline?.some(c=>(i=c.call({lexer:this},e,r))?(e=e.substring(i.raw.length),r.push(i),!0):!1))continue;if(i=this.tokenizer.escape(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.tag(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.link(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(i.raw.length);let c=r.at(-1);i.type==="text"&&c?.type==="text"?(c.raw+=i.raw,c.text+=i.text):r.push(i);continue}if(i=this.tokenizer.emStrong(e,o,d)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.codespan(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.br(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.del(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.autolink(e)){e=e.substring(i.raw.length),r.push(i);continue}if(!this.state.inLink&&(i=this.tokenizer.url(e))){e=e.substring(i.raw.length),r.push(i);continue}let u=e;if(this.options.extensions?.startInline){let c=1/0,l=e.slice(1),g;this.options.extensions.startInline.forEach(p=>{g=p.call({lexer:this},l),typeof g=="number"&&g>=0&&(c=Math.min(c,g))}),c<1/0&&c>=0&&(u=e.substring(0,c+1))}if(i=this.tokenizer.inlineText(u)){e=e.substring(i.raw.length),i.raw.slice(-1)!=="_"&&(d=i.raw.slice(-1)),s=!0;let c=r.at(-1);c?.type==="text"?(c.raw+=i.raw,c.text+=i.text):r.push(i);continue}if(e){let c="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(c);break}else throw new Error(c)}}return r}},be=class{options;parser;constructor(t){this.options=t||W}space(t){return""}code({text:t,lang:e,escaped:r}){let o=(e||"").match(R.notSpaceStart)?.[0],n=t.replace(R.endingNewline,"")+`
`;return o?'<pre><code class="language-'+j(o)+'">'+(r?n:j(n,!0))+`</code></pre>
`:"<pre><code>"+(r?n:j(n,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}def(t){return""}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){let e=t.ordered,r=t.start,o="";for(let s=0;s<t.items.length;s++){let d=t.items[s];o+=this.listitem(d)}let n=e?"ol":"ul",a=e&&r!==1?' start="'+r+'"':"";return"<"+n+a+`>
`+o+"</"+n+`>
`}listitem(t){return`<li>${this.parser.parse(t.tokens)}</li>
`}checkbox({checked:t}){return"<input "+(t?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:t}){return`<p>${this.parser.parseInline(t)}</p>
`}table(t){let e="",r="";for(let n=0;n<t.header.length;n++)r+=this.tablecell(t.header[n]);e+=this.tablerow({text:r});let o="";for(let n=0;n<t.rows.length;n++){let a=t.rows[n];r="";for(let s=0;s<a.length;s++)r+=this.tablecell(a[s]);o+=this.tablerow({text:r})}return o&&(o=`<tbody>${o}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+o+`</table>
`}tablerow({text:t}){return`<tr>
${t}</tr>
`}tablecell(t){let e=this.parser.parseInline(t.tokens),r=t.header?"th":"td";return(t.align?`<${r} align="${t.align}">`:`<${r}>`)+e+`</${r}>
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${j(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:r}){let o=this.parser.parseInline(r),n=Bt(t);if(n===null)return o;t=n;let a='<a href="'+t+'"';return e&&(a+=' title="'+j(e)+'"'),a+=">"+o+"</a>",a}image({href:t,title:e,text:r,tokens:o}){o&&(r=this.parser.parseInline(o,this.parser.textRenderer));let n=Bt(t);if(n===null)return j(r);t=n;let a=`<img src="${t}" alt="${r}"`;return e&&(a+=` title="${j(e)}"`),a+=">",a}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:j(t.text)}},je=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}checkbox({raw:t}){return t}},B=class Oe{options;renderer;textRenderer;constructor(e){this.options=e||W,this.options.renderer=this.options.renderer||new be,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new je}static parse(e,r){return new Oe(r).parse(e)}static parseInline(e,r){return new Oe(r).parseInline(e)}parse(e){let r="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let s=n,d=this.options.extensions.renderers[s.type].call({parser:this},s);if(d!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(s.type)){r+=d||"";continue}}let a=n;switch(a.type){case"space":{r+=this.renderer.space(a);break}case"hr":{r+=this.renderer.hr(a);break}case"heading":{r+=this.renderer.heading(a);break}case"code":{r+=this.renderer.code(a);break}case"table":{r+=this.renderer.table(a);break}case"blockquote":{r+=this.renderer.blockquote(a);break}case"list":{r+=this.renderer.list(a);break}case"checkbox":{r+=this.renderer.checkbox(a);break}case"html":{r+=this.renderer.html(a);break}case"def":{r+=this.renderer.def(a);break}case"paragraph":{r+=this.renderer.paragraph(a);break}case"text":{r+=this.renderer.text(a);break}default:{let s='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(s),"";throw new Error(s)}}}return r}parseInline(e,r=this.renderer){let o="";for(let n=0;n<e.length;n++){let a=e[n];if(this.options.extensions?.renderers?.[a.type]){let d=this.options.extensions.renderers[a.type].call({parser:this},a);if(d!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){o+=d||"";continue}}let s=a;switch(s.type){case"escape":{o+=r.text(s);break}case"html":{o+=r.html(s);break}case"link":{o+=r.link(s);break}case"image":{o+=r.image(s);break}case"checkbox":{o+=r.checkbox(s);break}case"strong":{o+=r.strong(s);break}case"em":{o+=r.em(s);break}case"codespan":{o+=r.codespan(s);break}case"br":{o+=r.br(s);break}case"del":{o+=r.del(s);break}case"text":{o+=r.text(s);break}default:{let d='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(d),"";throw new Error(d)}}}return o}},re=class{options;block;constructor(t){this.options=t||W}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}emStrongMask(t){return t}provideLexer(){return this.block?P.lex:P.lexInline}provideParser(){return this.block?B.parse:B.parseInline}},Fr=class{defaults=Ie();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=B;Renderer=be;TextRenderer=je;Lexer=P;Tokenizer=me;Hooks=re;constructor(...t){this.use(...t)}walkTokens(t,e){let r=[];for(let o of t)switch(r=r.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let a of n.header)r=r.concat(this.walkTokens(a.tokens,e));for(let a of n.rows)for(let s of a)r=r.concat(this.walkTokens(s.tokens,e));break}case"list":{let n=o;r=r.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(a=>{let s=n[a].flat(1/0);r=r.concat(this.walkTokens(s,e))}):n.tokens&&(r=r.concat(this.walkTokens(n.tokens,e)))}}return r}use(...t){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(r=>{let o={...r};if(o.async=this.defaults.async||o.async||!1,r.extensions&&(r.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let a=e.renderers[n.name];a?e.renderers[n.name]=function(...s){let d=n.renderer.apply(this,s);return d===!1&&(d=a.apply(this,s)),d}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=e[n.level];a?a.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),r.renderer){let n=this.defaults.renderer||new be(this.defaults);for(let a in r.renderer){if(!(a in n))throw new Error(`renderer '${a}' does not exist`);if(["options","parser"].includes(a))continue;let s=a,d=r.renderer[s],i=n[s];n[s]=(...u)=>{let c=d.apply(n,u);return c===!1&&(c=i.apply(n,u)),c||""}}o.renderer=n}if(r.tokenizer){let n=this.defaults.tokenizer||new me(this.defaults);for(let a in r.tokenizer){if(!(a in n))throw new Error(`tokenizer '${a}' does not exist`);if(["options","rules","lexer"].includes(a))continue;let s=a,d=r.tokenizer[s],i=n[s];n[s]=(...u)=>{let c=d.apply(n,u);return c===!1&&(c=i.apply(n,u)),c}}o.tokenizer=n}if(r.hooks){let n=this.defaults.hooks||new re;for(let a in r.hooks){if(!(a in n))throw new Error(`hook '${a}' does not exist`);if(["options","block"].includes(a))continue;let s=a,d=r.hooks[s],i=n[s];re.passThroughHooks.has(a)?n[s]=u=>{if(this.defaults.async&&re.passThroughHooksRespectAsync.has(a))return(async()=>{let l=await d.call(n,u);return i.call(n,l)})();let c=d.call(n,u);return i.call(n,c)}:n[s]=(...u)=>{if(this.defaults.async)return(async()=>{let l=await d.apply(n,u);return l===!1&&(l=await i.apply(n,u)),l})();let c=d.apply(n,u);return c===!1&&(c=i.apply(n,u)),c}}o.hooks=n}if(r.walkTokens){let n=this.defaults.walkTokens,a=r.walkTokens;o.walkTokens=function(s){let d=[];return d.push(a.call(this,s)),n&&(d=d.concat(n.call(this,s))),d}}this.defaults={...this.defaults,...o}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return P.lex(t,e??this.defaults)}parser(t,e){return B.parse(t,e??this.defaults)}parseMarkdown(t){return(e,r)=>{let o={...r},n={...this.defaults,...o},a=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=t),n.async)return(async()=>{let s=n.hooks?await n.hooks.preprocess(e):e,d=await(n.hooks?await n.hooks.provideLexer():t?P.lex:P.lexInline)(s,n),i=n.hooks?await n.hooks.processAllTokens(d):d;n.walkTokens&&await Promise.all(this.walkTokens(i,n.walkTokens));let u=await(n.hooks?await n.hooks.provideParser():t?B.parse:B.parseInline)(i,n);return n.hooks?await n.hooks.postprocess(u):u})().catch(a);try{n.hooks&&(e=n.hooks.preprocess(e));let s=(n.hooks?n.hooks.provideLexer():t?P.lex:P.lexInline)(e,n);n.hooks&&(s=n.hooks.processAllTokens(s)),n.walkTokens&&this.walkTokens(s,n.walkTokens);let d=(n.hooks?n.hooks.provideParser():t?B.parse:B.parseInline)(s,n);return n.hooks&&(d=n.hooks.postprocess(d)),d}catch(s){return a(s)}}}onError(t,e){return r=>{if(r.message+=`
Please report this to https://github.com/markedjs/marked.`,t){let o="<p>An error occurred:</p><pre>"+j(r.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(r);throw r}}},Z=new Fr;function x(t,e){return Z.parse(t,e)}x.options=x.setOptions=function(t){return Z.setOptions(t),x.defaults=Z.defaults,kt(x.defaults),x},x.getDefaults=Ie,x.defaults=W,x.use=function(...t){return Z.use(...t),x.defaults=Z.defaults,kt(x.defaults),x},x.walkTokens=function(t,e){return Z.walkTokens(t,e)},x.parseInline=Z.parseInline,x.Parser=B,x.parser=B.parse,x.Renderer=be,x.TextRenderer=je,x.Lexer=P,x.lexer=P.lex,x.Tokenizer=me,x.Hooks=re,x.parse=x,x.options,x.setOptions,x.use,x.walkTokens,x.parseInline,B.parse,P.lex;function Lr({className:t}){return h("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[h("path",{d:"m5 12 7-7 7 7"}),h("path",{d:"M12 19V5"})]})}function Nr({className:t}){return h("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:h("path",{d:"m6 9 6 6 6-6"})})}function Nt({className:t}){return h("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:h("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function Mt({className:t}){return h("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[h("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),h("path",{d:"M5 3v4"}),h("path",{d:"M19 17v4"}),h("path",{d:"M3 5h4"}),h("path",{d:"M17 19h4"})]})}function Mr({className:t}){return h("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[h("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),h("polyline",{points:"14 2 14 8 20 8"})]})}function Hr({className:t}){return h("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[h("circle",{cx:"11",cy:"11",r:"8"}),h("path",{d:"m21 21-4.3-4.3"})]})}x.setOptions({breaks:!0,gfm:!0});const Ht=new x.Renderer;Ht.link=({href:t,title:e,text:r})=>{const o=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${o}>${r}</a>`},x.use({renderer:Ht});function qr(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function jr(t){if(!t)return"";let e=t;return e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\(Source:[^)]*\)/gi,""),e=e.replace(/\[\d+\]/g,""),x.parse(e,{async:!1})}function Dr({message:t}){const[e,r]=U(!1),o=t.role==="user",n=t.citations&&t.citations.length>0;return h("div",{className:`grounded-message ${t.role}`,children:[h("div",{className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:o?qr(t.content):jr(t.content)}}),t.isStreaming&&h("span",{className:"grounded-cursor"}),!o&&n&&h("div",{className:"grounded-sources",children:[h("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>r(!e),children:[h(Nt,{}),t.citations.length," source",t.citations.length!==1?"s":"",h(Nr,{})]}),h("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((a,s)=>{const d=a.url?.startsWith("upload://"),i=a.title||(d?"Uploaded Document":a.url)||`Source ${s+1}`;return d?h("div",{className:"grounded-source grounded-source-file",children:[h(Mr,{}),h("span",{className:"grounded-source-title",children:i})]},s):h("a",{href:a.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[h(Nt,{}),h("span",{className:"grounded-source-title",children:i})]},s)})})]})]})}function Ur({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return h("div",{className:"grounded-status",children:h("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return h(Hr,{className:"grounded-status-icon"});case"generating":return h(Mt,{className:"grounded-status-icon"});default:return null}})(),h("span",{className:"grounded-status-text",children:e()}),h("div",{className:"grounded-status-dots",children:[h("div",{className:"grounded-typing-dot"}),h("div",{className:"grounded-typing-dot"}),h("div",{className:"grounded-typing-dot"})]})]})})}function Wr({config:t}){const{token:e,apiBase:r,agentName:o,welcomeMessage:n,logoUrl:a}=t,[s,d]=U(""),i=G(null),u=G(null),{messages:c,isLoading:l,chatStatus:g,sendMessage:p}=Kt({token:e,apiBase:r,endpointType:"chat-endpoint"});Ae(()=>{i.current&&i.current.scrollIntoView({behavior:"smooth"})},[c,l]),Ae(()=>{u.current?.focus()},[]);const f=G(!1);Ae(()=>{f.current&&!l&&setTimeout(()=>u.current?.focus(),50),f.current=l},[l]);const _=()=>{s.trim()&&!l&&(p(s),d(""),u.current&&(u.current.style.height="auto"),setTimeout(()=>u.current?.focus(),50))},y=w=>{w.key==="Enter"&&!w.shiftKey&&(w.preventDefault(),_())},k=w=>{const T=w.target;d(T.value),T.style.height="auto",T.style.height=Math.min(T.scrollHeight,120)+"px"},m=c.length===0&&!l,A=o.charAt(0).toUpperCase();return h("div",{className:"grounded-fullpage",children:[h("div",{className:"grounded-fullpage-header",children:[a?h("img",{src:a,alt:"",className:"grounded-fullpage-logo"}):h("div",{className:"grounded-fullpage-avatar",children:A}),h("div",{className:"grounded-fullpage-info",children:h("h1",{children:o})})]}),h("div",{className:"grounded-fullpage-messages",children:h("div",{className:"grounded-fullpage-messages-inner",children:[m?h("div",{className:"grounded-fullpage-welcome",children:[h(Mt,{className:"grounded-fullpage-welcome-icon"}),h("h2",{children:n}),h("p",{children:"Ask me anything. I'm here to help."})]}):h(Y,{children:[c.filter(w=>w.content||w.role==="user").map(w=>h(Dr,{message:w},w.id)),(l||g.status!=="idle")&&g.status!=="streaming"&&h(Ur,{status:g})]}),h("div",{ref:i})]})}),h("div",{className:"grounded-fullpage-input-area",children:h("div",{className:"grounded-fullpage-input-container",children:[h("textarea",{ref:u,className:"grounded-fullpage-input",placeholder:`Ask ${o} anything...`,value:s,onInput:k,onKeyDown:y,rows:1,disabled:l}),h("button",{className:"grounded-fullpage-send",onClick:_,disabled:!s.trim()||l,"aria-label":"Send message",children:h(Lr,{})})]})}),h("div",{className:"grounded-fullpage-footer",children:["Powered by ",h("a",{href:"https://github.com/grounded-ai",target:"_blank",rel:"noopener noreferrer",children:"Grounded"})]})]})}const Zr=`
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

  /* ============================================
     Full Page Chat Styles (Published Chat)
     ============================================ */

  .grounded-fullpage {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--grounded-bg);
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
    background: var(--grounded-bg);
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
    background: var(--grounded-bg);
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
    background: var(--grounded-bg);
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
`;class Or{constructor(){this.mounted=!1}init(e){if(this.mounted){console.warn("[Grounded Chat] Already initialized");return}if(!e?.token){console.error("[Grounded Chat] Token is required");return}const r=document.createElement("style");r.textContent=Zr,document.head.appendChild(r),document.body.classList.add("light");let o=document.getElementById("grounded-chat-root");o||(o=document.createElement("div"),o.id="grounded-chat-root",document.body.appendChild(o)),Gt(h(Wr,{config:e}),o),this.mounted=!0,console.log("[Grounded Chat] Initialized")}}const Gr=new Or;function De(t,e){t==="init"&&Gr.init(e)}const Qr=window.groundedChat?.q||[];for(const t of Qr)De(t[0],t[1]);return window.groundedChat=De,_e.groundedChat=De,Object.defineProperty(_e,Symbol.toStringTag,{value:"Module"}),_e})({});
