var GroundedWidget=(function(ue){"use strict";var ce,v,Xe,U,Ke,Je,et,tt,Ce,Te,Re,ee={},rt=[],Qt=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,ge=Array.isArray;function D(t,e){for(var r in e)t[r]=e[r];return t}function Ae(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function Vt(t,e,r){var o,n,a,s={};for(a in e)a=="key"?o=e[a]:a=="ref"?n=e[a]:s[a]=e[a];if(arguments.length>2&&(s.children=arguments.length>3?ce.call(arguments,2):r),typeof t=="function"&&t.defaultProps!=null)for(a in t.defaultProps)s[a]===void 0&&(s[a]=t.defaultProps[a]);return pe(t,s,o,n,null)}function pe(t,e,r,o,n){var a={type:t,props:e,key:r,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++Xe,__i:-1,__u:0};return n==null&&v.vnode!=null&&v.vnode(a),a}function Y(t){return t.children}function he(t,e){this.props=t,this.context=e}function X(t,e){if(e==null)return t.__?X(t.__,t.__i+1):null;for(var r;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null)return r.__e;return typeof t.type=="function"?X(t):null}function nt(t){var e,r;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null){t.__e=t.__c.base=r.__e;break}return nt(t)}}function ot(t){(!t.__d&&(t.__d=!0)&&U.push(t)&&!fe.__r++||Ke!=v.debounceRendering)&&((Ke=v.debounceRendering)||Je)(fe)}function fe(){for(var t,e,r,o,n,a,s,l=1;U.length;)U.length>l&&U.sort(et),t=U.shift(),l=U.length,t.__d&&(r=void 0,o=void 0,n=(o=(e=t).__v).__e,a=[],s=[],e.__P&&((r=D({},o)).__v=o.__v+1,v.vnode&&v.vnode(r),Ie(e.__P,r,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,a,n??X(o),!!(32&o.__u),s),r.__v=o.__v,r.__.__k[r.__i]=r,dt(a,r,s),o.__e=o.__=null,r.__e!=n&&nt(r)));fe.__r=0}function at(t,e,r,o,n,a,s,l,i,u,c){var d,p,h,f,x,y,m,b=o&&o.__k||rt,A=e.length;for(i=Yt(r,e,b,i,A),d=0;d<A;d++)(h=r.__k[d])!=null&&(p=h.__i==-1?ee:b[h.__i]||ee,h.__i=d,y=Ie(t,h,p,n,a,s,l,i,u,c),f=h.__e,h.ref&&p.ref!=h.ref&&(p.ref&&Ee(p.ref,null,h),c.push(h.ref,h.__c||f,h)),x==null&&f!=null&&(x=f),(m=!!(4&h.__u))||p.__k===h.__k?i=st(h,i,t,m):typeof h.type=="function"&&y!==void 0?i=y:f&&(i=f.nextSibling),h.__u&=-7);return r.__e=x,i}function Yt(t,e,r,o,n){var a,s,l,i,u,c=r.length,d=c,p=0;for(t.__k=new Array(n),a=0;a<n;a++)(s=e[a])!=null&&typeof s!="boolean"&&typeof s!="function"?(typeof s=="string"||typeof s=="number"||typeof s=="bigint"||s.constructor==String?s=t.__k[a]=pe(null,s,null,null,null):ge(s)?s=t.__k[a]=pe(Y,{children:s},null,null,null):s.constructor===void 0&&s.__b>0?s=t.__k[a]=pe(s.type,s.props,s.key,s.ref?s.ref:null,s.__v):t.__k[a]=s,i=a+p,s.__=t,s.__b=t.__b+1,l=null,(u=s.__i=Xt(s,r,i,d))!=-1&&(d--,(l=r[u])&&(l.__u|=2)),l==null||l.__v==null?(u==-1&&(n>c?p--:n<c&&p++),typeof s.type!="function"&&(s.__u|=4)):u!=i&&(u==i-1?p--:u==i+1?p++:(u>i?p--:p++,s.__u|=4))):t.__k[a]=null;if(d)for(a=0;a<c;a++)(l=r[a])!=null&&(2&l.__u)==0&&(l.__e==o&&(o=X(l)),ct(l,l));return o}function st(t,e,r,o){var n,a;if(typeof t.type=="function"){for(n=t.__k,a=0;n&&a<n.length;a++)n[a]&&(n[a].__=t,e=st(n[a],e,r,o));return e}t.__e!=e&&(o&&(e&&t.type&&!e.parentNode&&(e=X(t)),r.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function Xt(t,e,r,o){var n,a,s,l=t.key,i=t.type,u=e[r],c=u!=null&&(2&u.__u)==0;if(u===null&&l==null||c&&l==u.key&&i==u.type)return r;if(o>(c?1:0)){for(n=r-1,a=r+1;n>=0||a<e.length;)if((u=e[s=n>=0?n--:a++])!=null&&(2&u.__u)==0&&l==u.key&&i==u.type)return s}return-1}function it(t,e,r){e[0]=="-"?t.setProperty(e,r??""):t[e]=r==null?"":typeof r!="number"||Qt.test(e)?r:r+"px"}function me(t,e,r,o,n){var a,s;e:if(e=="style")if(typeof r=="string")t.style.cssText=r;else{if(typeof o=="string"&&(t.style.cssText=o=""),o)for(e in o)r&&e in r||it(t.style,e,"");if(r)for(e in r)o&&r[e]==o[e]||it(t.style,e,r[e])}else if(e[0]=="o"&&e[1]=="n")a=e!=(e=e.replace(tt,"$1")),s=e.toLowerCase(),e=s in t||e=="onFocusOut"||e=="onFocusIn"?s.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+a]=r,r?o?r.u=o.u:(r.u=Ce,t.addEventListener(e,a?Re:Te,a)):t.removeEventListener(e,a?Re:Te,a);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&r==1?"":r))}}function lt(t){return function(e){if(this.l){var r=this.l[e.type+t];if(e.t==null)e.t=Ce++;else if(e.t<r.u)return;return r(v.event?v.event(e):e)}}}function Ie(t,e,r,o,n,a,s,l,i,u){var c,d,p,h,f,x,y,m,b,A,z,T,R,E,M,B,I,L=e.type;if(e.constructor!==void 0)return null;128&r.__u&&(i=!!(32&r.__u),a=[l=e.__e=r.__e]),(c=v.__b)&&c(e);e:if(typeof L=="function")try{if(m=e.props,b="prototype"in L&&L.prototype.render,A=(c=L.contextType)&&o[c.__c],z=c?A?A.props.value:c.__:o,r.__c?y=(d=e.__c=r.__c).__=d.__E:(b?e.__c=d=new L(m,z):(e.__c=d=new he(m,z),d.constructor=L,d.render=Jt),A&&A.sub(d),d.state||(d.state={}),d.__n=o,p=d.__d=!0,d.__h=[],d._sb=[]),b&&d.__s==null&&(d.__s=d.state),b&&L.getDerivedStateFromProps!=null&&(d.__s==d.state&&(d.__s=D({},d.__s)),D(d.__s,L.getDerivedStateFromProps(m,d.__s))),h=d.props,f=d.state,d.__v=e,p)b&&L.getDerivedStateFromProps==null&&d.componentWillMount!=null&&d.componentWillMount(),b&&d.componentDidMount!=null&&d.__h.push(d.componentDidMount);else{if(b&&L.getDerivedStateFromProps==null&&m!==h&&d.componentWillReceiveProps!=null&&d.componentWillReceiveProps(m,z),e.__v==r.__v||!d.__e&&d.shouldComponentUpdate!=null&&d.shouldComponentUpdate(m,d.__s,z)===!1){for(e.__v!=r.__v&&(d.props=m,d.state=d.__s,d.__d=!1),e.__e=r.__e,e.__k=r.__k,e.__k.some(function(F){F&&(F.__=e)}),T=0;T<d._sb.length;T++)d.__h.push(d._sb[T]);d._sb=[],d.__h.length&&s.push(d);break e}d.componentWillUpdate!=null&&d.componentWillUpdate(m,d.__s,z),b&&d.componentDidUpdate!=null&&d.__h.push(function(){d.componentDidUpdate(h,f,x)})}if(d.context=z,d.props=m,d.__P=t,d.__e=!1,R=v.__r,E=0,b){for(d.state=d.__s,d.__d=!1,R&&R(e),c=d.render(d.props,d.state,d.context),M=0;M<d._sb.length;M++)d.__h.push(d._sb[M]);d._sb=[]}else do d.__d=!1,R&&R(e),c=d.render(d.props,d.state,d.context),d.state=d.__s;while(d.__d&&++E<25);d.state=d.__s,d.getChildContext!=null&&(o=D(D({},o),d.getChildContext())),b&&!p&&d.getSnapshotBeforeUpdate!=null&&(x=d.getSnapshotBeforeUpdate(h,f)),B=c,c!=null&&c.type===Y&&c.key==null&&(B=ut(c.props.children)),l=at(t,ge(B)?B:[B],e,r,o,n,a,s,l,i,u),d.base=e.__e,e.__u&=-161,d.__h.length&&s.push(d),y&&(d.__E=d.__=null)}catch(F){if(e.__v=null,i||a!=null)if(F.then){for(e.__u|=i?160:128;l&&l.nodeType==8&&l.nextSibling;)l=l.nextSibling;a[a.indexOf(l)]=null,e.__e=l}else{for(I=a.length;I--;)Ae(a[I]);Le(e)}else e.__e=r.__e,e.__k=r.__k,F.then||Le(e);v.__e(F,e,r)}else a==null&&e.__v==r.__v?(e.__k=r.__k,e.__e=r.__e):l=e.__e=Kt(r.__e,e,r,o,n,a,s,i,u);return(c=v.diffed)&&c(e),128&e.__u?void 0:l}function Le(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Le)}function dt(t,e,r){for(var o=0;o<r.length;o++)Ee(r[o],r[++o],r[++o]);v.__c&&v.__c(e,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(a){a.call(n)})}catch(a){v.__e(a,n.__v)}})}function ut(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:ge(t)?t.map(ut):D({},t)}function Kt(t,e,r,o,n,a,s,l,i){var u,c,d,p,h,f,x,y=r.props||ee,m=e.props,b=e.type;if(b=="svg"?n="http://www.w3.org/2000/svg":b=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),a!=null){for(u=0;u<a.length;u++)if((h=a[u])&&"setAttribute"in h==!!b&&(b?h.localName==b:h.nodeType==3)){t=h,a[u]=null;break}}if(t==null){if(b==null)return document.createTextNode(m);t=document.createElementNS(n,b,m.is&&m),l&&(v.__m&&v.__m(e,a),l=!1),a=null}if(b==null)y===m||l&&t.data==m||(t.data=m);else{if(a=a&&ce.call(t.childNodes),!l&&a!=null)for(y={},u=0;u<t.attributes.length;u++)y[(h=t.attributes[u]).name]=h.value;for(u in y)if(h=y[u],u!="children"){if(u=="dangerouslySetInnerHTML")d=h;else if(!(u in m)){if(u=="value"&&"defaultValue"in m||u=="checked"&&"defaultChecked"in m)continue;me(t,u,null,h,n)}}for(u in m)h=m[u],u=="children"?p=h:u=="dangerouslySetInnerHTML"?c=h:u=="value"?f=h:u=="checked"?x=h:l&&typeof h!="function"||y[u]===h||me(t,u,h,y[u],n);if(c)l||d&&(c.__html==d.__html||c.__html==t.innerHTML)||(t.innerHTML=c.__html),e.__k=[];else if(d&&(t.innerHTML=""),at(e.type=="template"?t.content:t,ge(p)?p:[p],e,r,o,b=="foreignObject"?"http://www.w3.org/1999/xhtml":n,a,s,a?a[0]:r.__k&&X(r,0),l,i),a!=null)for(u=a.length;u--;)Ae(a[u]);l||(u="value",b=="progress"&&f==null?t.removeAttribute("value"):f!=null&&(f!==t[u]||b=="progress"&&!f||b=="option"&&f!=y[u])&&me(t,u,f,y[u],n),u="checked",x!=null&&x!=t[u]&&me(t,u,x,y[u],n))}return t}function Ee(t,e,r){try{if(typeof t=="function"){var o=typeof t.__u=="function";o&&t.__u(),o&&e==null||(t.__u=t(e))}else t.current=e}catch(n){v.__e(n,r)}}function ct(t,e,r){var o,n;if(v.unmount&&v.unmount(t),(o=t.ref)&&(o.current&&o.current!=t.__e||Ee(o,null,e)),(o=t.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(a){v.__e(a,e)}o.base=o.__P=null}if(o=t.__k)for(n=0;n<o.length;n++)o[n]&&ct(o[n],e,r||typeof t.type!="function");r||Ae(t.__e),t.__c=t.__=t.__e=void 0}function Jt(t,e,r){return this.constructor(t,r)}function gt(t,e,r){var o,n,a,s;e==document&&(e=document.documentElement),v.__&&v.__(t,e),n=(o=!1)?null:e.__k,a=[],s=[],Ie(e,t=e.__k=Vt(Y,null,[t]),n||ee,ee,e.namespaceURI,n?null:e.firstChild?ce.call(e.childNodes):null,a,n?n.__e:e.firstChild,o,s),dt(a,t,s)}ce=rt.slice,v={__e:function(t,e,r,o){for(var n,a,s;e=e.__;)if((n=e.__c)&&!n.__)try{if((a=n.constructor)&&a.getDerivedStateFromError!=null&&(n.setState(a.getDerivedStateFromError(t)),s=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(t,o||{}),s=n.__d),s)return n.__E=n}catch(l){t=l}throw t}},Xe=0,he.prototype.setState=function(t,e){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=D({},this.state),typeof t=="function"&&(t=t(D({},r),this.props)),t&&D(r,t),t!=null&&this.__v&&(e&&this._sb.push(e),ot(this))},he.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),ot(this))},he.prototype.render=Y,U=[],Je=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,et=function(t,e){return t.__v.__b-e.__v.__b},fe.__r=0,tt=/(PointerCapture)$|Capture$/i,Ce=0,Te=lt(!1),Re=lt(!0);var er=0;function g(t,e,r,o,n,a){e||(e={});var s,l,i=e;if("ref"in i)for(l in i={},e)l=="ref"?s=e[l]:i[l]=e[l];var u={type:t,props:i,key:r,ref:s,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--er,__i:-1,__u:0,__source:n,__self:a};if(typeof t=="function"&&(s=t.defaultProps))for(l in s)i[l]===void 0&&(i[l]=s[l]);return v.vnode&&v.vnode(u),u}var te,w,Be,pt,re=0,ht=[],S=v,ft=S.__b,mt=S.__r,bt=S.diffed,xt=S.__c,_t=S.unmount,kt=S.__;function Pe(t,e){S.__h&&S.__h(w,t,re||e),re=0;var r=w.__H||(w.__H={__:[],__h:[]});return t>=r.__.length&&r.__.push({}),r.__[t]}function N(t){return re=1,tr(St,t)}function tr(t,e,r){var o=Pe(te++,2);if(o.t=t,!o.__c&&(o.__=[St(void 0,e),function(l){var i=o.__N?o.__N[0]:o.__[0],u=o.t(i,l);i!==u&&(o.__N=[u,o.__[1]],o.__c.setState({}))}],o.__c=w,!w.__f)){var n=function(l,i,u){if(!o.__c.__H)return!0;var c=o.__c.__H.__.filter(function(p){return!!p.__c});if(c.every(function(p){return!p.__N}))return!a||a.call(this,l,i,u);var d=o.__c.props!==l;return c.forEach(function(p){if(p.__N){var h=p.__[0];p.__=p.__N,p.__N=void 0,h!==p.__[0]&&(d=!0)}}),a&&a.call(this,l,i,u)||d};w.__f=!0;var a=w.shouldComponentUpdate,s=w.componentWillUpdate;w.componentWillUpdate=function(l,i,u){if(this.__e){var c=a;a=void 0,n(l,i,u),a=c}s&&s.call(this,l,i,u)},w.shouldComponentUpdate=n}return o.__N||o.__}function ne(t,e){var r=Pe(te++,3);!S.__s&&wt(r.__H,e)&&(r.__=t,r.u=e,w.__H.__h.push(r))}function K(t){return re=5,vt(function(){return{current:t}},[])}function vt(t,e){var r=Pe(te++,7);return wt(r.__H,e)&&(r.__=t(),r.__H=e,r.__h=t),r.__}function Ne(t,e){return re=8,vt(function(){return t},e)}function rr(){for(var t;t=ht.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(be),t.__H.__h.forEach(Me),t.__H.__h=[]}catch(e){t.__H.__h=[],S.__e(e,t.__v)}}S.__b=function(t){w=null,ft&&ft(t)},S.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),kt&&kt(t,e)},S.__r=function(t){mt&&mt(t),te=0;var e=(w=t.__c).__H;e&&(Be===w?(e.__h=[],w.__h=[],e.__.forEach(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(e.__h.forEach(be),e.__h.forEach(Me),e.__h=[],te=0)),Be=w},S.diffed=function(t){bt&&bt(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(ht.push(e)!==1&&pt===S.requestAnimationFrame||((pt=S.requestAnimationFrame)||nr)(rr)),e.__H.__.forEach(function(r){r.u&&(r.__H=r.u),r.u=void 0})),Be=w=null},S.__c=function(t,e){e.some(function(r){try{r.__h.forEach(be),r.__h=r.__h.filter(function(o){return!o.__||Me(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],S.__e(o,r.__v)}}),xt&&xt(t,e)},S.unmount=function(t){_t&&_t(t);var e,r=t.__c;r&&r.__H&&(r.__H.__.forEach(function(o){try{be(o)}catch(n){e=n}}),r.__H=void 0,e&&S.__e(e,r.__v))};var yt=typeof requestAnimationFrame=="function";function nr(t){var e,r=function(){clearTimeout(o),yt&&cancelAnimationFrame(e),setTimeout(t)},o=setTimeout(r,35);yt&&(e=requestAnimationFrame(r))}function be(t){var e=w,r=t.__c;typeof r=="function"&&(t.__c=void 0,r()),w=e}function Me(t){var e=w;t.__c=t.__(),w=e}function wt(t,e){return!t||t.length!==e.length||e.some(function(r,o){return r!==t[o]})}function St(t,e){return typeof e=="function"?e(t):e}function or({token:t,apiBase:e,endpointType:r="widget"}){const[o,n]=N([]),[a,s]=N(!1),[l,i]=N(!1),[u,c]=N(null),[d,p]=N({status:"idle"}),h=K(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),f=K(null),x=K(null),y=()=>Math.random().toString(36).slice(2,11),m=Ne(async z=>{if(!z.trim()||a||l)return;const T={id:y(),role:"user",content:z.trim(),timestamp:Date.now()},R=y();n(E=>[...E,T]),s(!0),i(!0),c(null),p({status:"searching",message:"Searching knowledge base..."}),x.current=null,f.current=new AbortController;try{const E={message:z.trim()};h.current&&(E.conversationId=h.current);const M=r==="chat-endpoint"?`${e}/api/v1/c/${t}/chat/stream`:`${e}/api/v1/widget/${t}/chat/stream`,B=await fetch(M,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(E),signal:f.current.signal});if(!B.ok){const V=await B.json().catch(()=>({}));throw new Error(V.message||`Request failed: ${B.status}`)}n(V=>[...V,{id:R,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),s(!1);const I=B.body?.getReader();if(!I)throw new Error("No response body");const L=new TextDecoder;let F="",Q="";for(;;){const{done:V,value:Se}=await I.read();if(V)break;F+=L.decode(Se,{stream:!0});const $e=F.split(`
`);F=$e.pop()||"";for(const de of $e)if(de.startsWith("data: "))try{const $=JSON.parse(de.slice(6));if($.type==="status"){const H=$.status==="searching"?"searching":$.status==="generating"?"generating":"searching";p({status:H,message:$.message,sourcesCount:$.sourcesCount})}else if($.type==="sources"&&$.sources)x.current=$.sources.map(H=>({index:H.index,title:H.title,url:H.url,snippet:H.snippet}));else if($.type==="text"&&$.content)Q||p({status:"streaming"}),Q+=$.content,n(H=>H.map(O=>O.id===R?{...O,content:Q}:O));else if($.type==="done"){if($.conversationId){h.current=$.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,$.conversationId)}catch{}}const H=x.current?[...x.current]:[];x.current=null,n(O=>O.map(J=>J.id===R?{...J,content:Q,isStreaming:!1,citations:H}:J)),p({status:"idle"})}else if($.type==="error")throw new Error($.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",de)}}}catch(E){if(E.name==="AbortError"){p({status:"idle"});return}p({status:"idle"}),c(E instanceof Error?E.message:"An error occurred"),n(M=>M.some(I=>I.id===R)?M.map(I=>I.id===R?{...I,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:I):[...M,{id:R,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{s(!1),i(!1),f.current=null}},[t,e,a,l]),b=Ne(()=>{f.current&&(f.current.abort(),f.current=null),i(!1),s(!1)},[]),A=Ne(()=>{n([]),h.current=null;try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:o,isLoading:a,isStreaming:l,error:u,chatStatus:d,sendMessage:m,stopStreaming:b,clearMessages:A}}function ar({token:t,apiBase:e,enabled:r=!0}){const[o,n]=N(null),[a,s]=N(!0),[l,i]=N(null);return ne(()=>{if(!r)return;async function u(){s(!0);try{const c=await fetch(`${e}/api/v1/widget/${t}/config`);if(!c.ok)throw new Error("Failed to load widget configuration");const d=await c.json();n(d)}catch(c){i(c instanceof Error?c.message:"Configuration error"),n({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0})}finally{s(!1)}}u()},[t,e,r]),{config:o,isLoading:a,error:l}}function Fe(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var Z=Fe();function $t(t){Z=t}var oe={exec:()=>null};function _(t,e=""){let r=typeof t=="string"?t:t.source,o={replace:(n,a)=>{let s=typeof a=="string"?a:a.source;return s=s.replace(C.caret,"$1"),r=r.replace(n,s),o},getRegex:()=>new RegExp(r,e)};return o}var sr=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),C={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},ir=/^(?:[ \t]*(?:\n|$))+/,lr=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,dr=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,ae=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,ur=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,He=/(?:[*+-]|\d{1,9}[.)])/,zt=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,Ct=_(zt).replace(/bull/g,He).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),cr=_(zt).replace(/bull/g,He).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),qe=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,gr=/^[^\n]+/,je=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,pr=_(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",je).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),hr=_(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,He).getRegex(),xe="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",De=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,fr=_("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",De).replace("tag",xe).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),Tt=_(qe).replace("hr",ae).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",xe).getRegex(),mr=_(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",Tt).getRegex(),We={blockquote:mr,code:lr,def:pr,fences:dr,heading:ur,hr:ae,html:fr,lheading:Ct,list:hr,newline:ir,paragraph:Tt,table:oe,text:gr},Rt=_("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",ae).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",xe).getRegex(),br={...We,lheading:cr,table:Rt,paragraph:_(qe).replace("hr",ae).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Rt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",xe).getRegex()},xr={...We,html:_(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",De).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:oe,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:_(qe).replace("hr",ae).replace("heading",` *#{1,6} *[^
]`).replace("lheading",Ct).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},_r=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,kr=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,At=/^( {2,}|\\)\n(?!\s*$)/,vr=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,_e=/[\p{P}\p{S}]/u,Oe=/[\s\p{P}\p{S}]/u,It=/[^\s\p{P}\p{S}]/u,yr=_(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Oe).getRegex(),Lt=/(?!~)[\p{P}\p{S}]/u,wr=/(?!~)[\s\p{P}\p{S}]/u,Sr=/(?:[^\s\p{P}\p{S}]|~)/u,$r=_(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",sr?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Et=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,zr=_(Et,"u").replace(/punct/g,_e).getRegex(),Cr=_(Et,"u").replace(/punct/g,Lt).getRegex(),Bt="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Tr=_(Bt,"gu").replace(/notPunctSpace/g,It).replace(/punctSpace/g,Oe).replace(/punct/g,_e).getRegex(),Rr=_(Bt,"gu").replace(/notPunctSpace/g,Sr).replace(/punctSpace/g,wr).replace(/punct/g,Lt).getRegex(),Ar=_("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,It).replace(/punctSpace/g,Oe).replace(/punct/g,_e).getRegex(),Ir=_(/\\(punct)/,"gu").replace(/punct/g,_e).getRegex(),Lr=_(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Er=_(De).replace("(?:-->|$)","-->").getRegex(),Br=_("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Er).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),ke=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,Pr=_(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",ke).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Pt=_(/^!?\[(label)\]\[(ref)\]/).replace("label",ke).replace("ref",je).getRegex(),Nt=_(/^!?\[(ref)\](?:\[\])?/).replace("ref",je).getRegex(),Nr=_("reflink|nolink(?!\\()","g").replace("reflink",Pt).replace("nolink",Nt).getRegex(),Mt=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,Ue={_backpedal:oe,anyPunctuation:Ir,autolink:Lr,blockSkip:$r,br:At,code:kr,del:oe,emStrongLDelim:zr,emStrongRDelimAst:Tr,emStrongRDelimUnd:Ar,escape:_r,link:Pr,nolink:Nt,punctuation:yr,reflink:Pt,reflinkSearch:Nr,tag:Br,text:vr,url:oe},Mr={...Ue,link:_(/^!?\[(label)\]\((.*?)\)/).replace("label",ke).getRegex(),reflink:_(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",ke).getRegex()},Ze={...Ue,emStrongRDelimAst:Rr,emStrongLDelim:Cr,url:_(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",Mt).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:_(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",Mt).getRegex()},Fr={...Ze,br:_(At).replace("{2,}","*").getRegex(),text:_(Ze.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},ve={normal:We,gfm:br,pedantic:xr},se={normal:Ue,gfm:Ze,breaks:Fr,pedantic:Mr},Hr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Ft=t=>Hr[t];function W(t,e){if(e){if(C.escapeTest.test(t))return t.replace(C.escapeReplace,Ft)}else if(C.escapeTestNoEncode.test(t))return t.replace(C.escapeReplaceNoEncode,Ft);return t}function Ht(t){try{t=encodeURI(t).replace(C.percentDecode,"%")}catch{return null}return t}function qt(t,e){let r=t.replace(C.findPipe,(a,s,l)=>{let i=!1,u=s;for(;--u>=0&&l[u]==="\\";)i=!i;return i?"|":" |"}),o=r.split(C.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(C.slashPipe,"|");return o}function ie(t,e,r){let o=t.length;if(o===0)return"";let n=0;for(;n<o&&t.charAt(o-n-1)===e;)n++;return t.slice(0,o-n)}function qr(t,e){if(t.indexOf(e[1])===-1)return-1;let r=0;for(let o=0;o<t.length;o++)if(t[o]==="\\")o++;else if(t[o]===e[0])r++;else if(t[o]===e[1]&&(r--,r<0))return o;return r>0?-2:-1}function jt(t,e,r,o,n){let a=e.href,s=e.title||null,l=t[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let i={type:t[0].charAt(0)==="!"?"image":"link",raw:r,href:a,title:s,text:l,tokens:o.inlineTokens(l)};return o.state.inLink=!1,i}function jr(t,e,r){let o=t.match(r.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(a=>{let s=a.match(r.other.beginningSpace);if(s===null)return a;let[l]=s;return l.length>=n.length?a.slice(n.length):a}).join(`
`)}var ye=class{options;rules;lexer;constructor(t){this.options=t||Z}space(t){let e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){let e=this.rules.block.code.exec(t);if(e){let r=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?r:ie(r,`
`)}}}fences(t){let e=this.rules.block.fences.exec(t);if(e){let r=e[0],o=jr(r,e[3]||"",this.rules);return{type:"code",raw:r,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(t){let e=this.rules.block.heading.exec(t);if(e){let r=e[2].trim();if(this.rules.other.endingHash.test(r)){let o=ie(r,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(r=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:r,tokens:this.lexer.inline(r)}}}hr(t){let e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:ie(e[0],`
`)}}blockquote(t){let e=this.rules.block.blockquote.exec(t);if(e){let r=ie(e[0],`
`).split(`
`),o="",n="",a=[];for(;r.length>0;){let s=!1,l=[],i;for(i=0;i<r.length;i++)if(this.rules.other.blockquoteStart.test(r[i]))l.push(r[i]),s=!0;else if(!s)l.push(r[i]);else break;r=r.slice(i);let u=l.join(`
`),c=u.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${u}`:u,n=n?`${n}
${c}`:c;let d=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(c,a,!0),this.lexer.state.top=d,r.length===0)break;let p=a.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){let h=p,f=h.raw+`
`+r.join(`
`),x=this.blockquote(f);a[a.length-1]=x,o=o.substring(0,o.length-h.raw.length)+x.raw,n=n.substring(0,n.length-h.text.length)+x.text;break}else if(p?.type==="list"){let h=p,f=h.raw+`
`+r.join(`
`),x=this.list(f);a[a.length-1]=x,o=o.substring(0,o.length-p.raw.length)+x.raw,n=n.substring(0,n.length-h.raw.length)+x.raw,r=f.substring(a.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:a,text:n}}}list(t){let e=this.rules.block.list.exec(t);if(e){let r=e[1].trim(),o=r.length>1,n={type:"list",raw:"",ordered:o,start:o?+r.slice(0,-1):"",loose:!1,items:[]};r=o?`\\d{1,9}\\${r.slice(-1)}`:`\\${r}`,this.options.pedantic&&(r=o?r:"[*+-]");let a=this.rules.other.listItemRegex(r),s=!1;for(;t;){let i=!1,u="",c="";if(!(e=a.exec(t))||this.rules.block.hr.test(t))break;u=e[0],t=t.substring(u.length);let d=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,x=>" ".repeat(3*x.length)),p=t.split(`
`,1)[0],h=!d.trim(),f=0;if(this.options.pedantic?(f=2,c=d.trimStart()):h?f=e[1].length+1:(f=e[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,c=d.slice(f),f+=e[1].length),h&&this.rules.other.blankLine.test(p)&&(u+=p+`
`,t=t.substring(p.length+1),i=!0),!i){let x=this.rules.other.nextBulletRegex(f),y=this.rules.other.hrRegex(f),m=this.rules.other.fencesBeginRegex(f),b=this.rules.other.headingBeginRegex(f),A=this.rules.other.htmlBeginRegex(f);for(;t;){let z=t.split(`
`,1)[0],T;if(p=z,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),T=p):T=p.replace(this.rules.other.tabCharGlobal,"    "),m.test(p)||b.test(p)||A.test(p)||x.test(p)||y.test(p))break;if(T.search(this.rules.other.nonSpaceChar)>=f||!p.trim())c+=`
`+T.slice(f);else{if(h||d.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||m.test(d)||b.test(d)||y.test(d))break;c+=`
`+p}!h&&!p.trim()&&(h=!0),u+=z+`
`,t=t.substring(z.length+1),d=T.slice(f)}}n.loose||(s?n.loose=!0:this.rules.other.doubleBlankLine.test(u)&&(s=!0)),n.items.push({type:"list_item",raw:u,task:!!this.options.gfm&&this.rules.other.listIsTask.test(c),loose:!1,text:c,tokens:[]}),n.raw+=u}let l=n.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let i of n.items){if(this.lexer.state.top=!1,i.tokens=this.lexer.blockTokens(i.text,[]),i.task){if(i.text=i.text.replace(this.rules.other.listReplaceTask,""),i.tokens[0]?.type==="text"||i.tokens[0]?.type==="paragraph"){i.tokens[0].raw=i.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),i.tokens[0].text=i.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let c=this.lexer.inlineQueue.length-1;c>=0;c--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[c].src)){this.lexer.inlineQueue[c].src=this.lexer.inlineQueue[c].src.replace(this.rules.other.listReplaceTask,"");break}}let u=this.rules.other.listTaskCheckbox.exec(i.raw);if(u){let c={type:"checkbox",raw:u[0]+" ",checked:u[0]!=="[ ]"};i.checked=c.checked,n.loose?i.tokens[0]&&["paragraph","text"].includes(i.tokens[0].type)&&"tokens"in i.tokens[0]&&i.tokens[0].tokens?(i.tokens[0].raw=c.raw+i.tokens[0].raw,i.tokens[0].text=c.raw+i.tokens[0].text,i.tokens[0].tokens.unshift(c)):i.tokens.unshift({type:"paragraph",raw:c.raw,text:c.raw,tokens:[c]}):i.tokens.unshift(c)}}if(!n.loose){let u=i.tokens.filter(d=>d.type==="space"),c=u.length>0&&u.some(d=>this.rules.other.anyLine.test(d.raw));n.loose=c}}if(n.loose)for(let i of n.items){i.loose=!0;for(let u of i.tokens)u.type==="text"&&(u.type="paragraph")}return n}}html(t){let e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){let e=this.rules.block.def.exec(t);if(e){let r=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:r,raw:e[0],href:o,title:n}}}table(t){let e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let r=qt(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],a={type:"table",raw:e[0],header:[],align:[],rows:[]};if(r.length===o.length){for(let s of o)this.rules.other.tableAlignRight.test(s)?a.align.push("right"):this.rules.other.tableAlignCenter.test(s)?a.align.push("center"):this.rules.other.tableAlignLeft.test(s)?a.align.push("left"):a.align.push(null);for(let s=0;s<r.length;s++)a.header.push({text:r[s],tokens:this.lexer.inline(r[s]),header:!0,align:a.align[s]});for(let s of n)a.rows.push(qt(s,a.header.length).map((l,i)=>({text:l,tokens:this.lexer.inline(l),header:!1,align:a.align[i]})));return a}}lheading(t){let e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){let e=this.rules.block.paragraph.exec(t);if(e){let r=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:r,tokens:this.lexer.inline(r)}}}text(t){let e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){let e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){let e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){let e=this.rules.inline.link.exec(t);if(e){let r=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let a=ie(r.slice(0,-1),"\\");if((r.length-a.length)%2===0)return}else{let a=qr(e[2],"()");if(a===-2)return;if(a>-1){let s=(e[0].indexOf("!")===0?5:4)+e[1].length+a;e[2]=e[2].substring(0,a),e[0]=e[0].substring(0,s).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(o);a&&(o=a[1],n=a[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?o=o.slice(1):o=o.slice(1,-1)),jt(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let r;if((r=this.rules.inline.reflink.exec(t))||(r=this.rules.inline.nolink.exec(t))){let o=(r[2]||r[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let a=r[0].charAt(0);return{type:"text",raw:a,text:a}}return jt(r,n,r[0],this.lexer,this.rules)}}emStrong(t,e,r=""){let o=this.rules.inline.emStrongLDelim.exec(t);if(!(!o||o[3]&&r.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!r||this.rules.inline.punctuation.exec(r))){let n=[...o[0]].length-1,a,s,l=n,i=0,u=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(u.lastIndex=0,e=e.slice(-1*t.length+n);(o=u.exec(e))!=null;){if(a=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!a)continue;if(s=[...a].length,o[3]||o[4]){l+=s;continue}else if((o[5]||o[6])&&n%3&&!((n+s)%3)){i+=s;continue}if(l-=s,l>0)continue;s=Math.min(s,s+l+i);let c=[...o[0]][0].length,d=t.slice(0,n+o.index+c+s);if(Math.min(n,s)%2){let h=d.slice(1,-1);return{type:"em",raw:d,text:h,tokens:this.lexer.inlineTokens(h)}}let p=d.slice(2,-2);return{type:"strong",raw:d,text:p,tokens:this.lexer.inlineTokens(p)}}}}codespan(t){let e=this.rules.inline.code.exec(t);if(e){let r=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(r),n=this.rules.other.startingSpaceChar.test(r)&&this.rules.other.endingSpaceChar.test(r);return o&&n&&(r=r.substring(1,r.length-1)),{type:"codespan",raw:e[0],text:r}}}br(t){let e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){let e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){let e=this.rules.inline.autolink.exec(t);if(e){let r,o;return e[2]==="@"?(r=e[1],o="mailto:"+r):(r=e[1],o=r),{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}url(t){let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){let e=this.rules.inline.text.exec(t);if(e){let r=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:r}}}},q=class Ve{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||Z,this.options.tokenizer=this.options.tokenizer||new ye,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let r={other:C,block:ve.normal,inline:se.normal};this.options.pedantic?(r.block=ve.pedantic,r.inline=se.pedantic):this.options.gfm&&(r.block=ve.gfm,this.options.breaks?r.inline=se.breaks:r.inline=se.gfm),this.tokenizer.rules=r}static get rules(){return{block:ve,inline:se}}static lex(e,r){return new Ve(r).lex(e)}static lexInline(e,r){return new Ve(r).inlineTokens(e)}lex(e){e=e.replace(C.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let r=0;r<this.inlineQueue.length;r++){let o=this.inlineQueue[r];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,r=[],o=!1){for(this.options.pedantic&&(e=e.replace(C.tabCharGlobal,"    ").replace(C.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(s=>(n=s.call({lexer:this},e,r))?(e=e.substring(n.raw.length),r.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let s=r.at(-1);n.raw.length===1&&s!==void 0?s.raw+=`
`:r.push(n);continue}if(n=this.tokenizer.code(e)){e=e.substring(n.raw.length);let s=r.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.at(-1).src=s.text):r.push(n);continue}if(n=this.tokenizer.fences(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.heading(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.hr(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.blockquote(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.list(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.html(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.def(e)){e=e.substring(n.raw.length);let s=r.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.raw,this.inlineQueue.at(-1).src=s.text):this.tokens.links[n.tag]||(this.tokens.links[n.tag]={href:n.href,title:n.title},r.push(n));continue}if(n=this.tokenizer.table(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.lheading(e)){e=e.substring(n.raw.length),r.push(n);continue}let a=e;if(this.options.extensions?.startBlock){let s=1/0,l=e.slice(1),i;this.options.extensions.startBlock.forEach(u=>{i=u.call({lexer:this},l),typeof i=="number"&&i>=0&&(s=Math.min(s,i))}),s<1/0&&s>=0&&(a=e.substring(0,s+1))}if(this.state.top&&(n=this.tokenizer.paragraph(a))){let s=r.at(-1);o&&s?.type==="paragraph"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):r.push(n),o=a.length!==e.length,e=e.substring(n.raw.length);continue}if(n=this.tokenizer.text(e)){e=e.substring(n.raw.length);let s=r.at(-1);s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):r.push(n);continue}if(e){let s="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(s);break}else throw new Error(s)}}return this.state.top=!0,r}inline(e,r=[]){return this.inlineQueue.push({src:e,tokens:r}),r}inlineTokens(e,r=[]){let o=e,n=null;if(this.tokens.links){let i=Object.keys(this.tokens.links);if(i.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)i.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)a=n[2]?n[2].length:0,o=o.slice(0,n.index+a)+"["+"a".repeat(n[0].length-a-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let s=!1,l="";for(;e;){s||(l=""),s=!1;let i;if(this.options.extensions?.inline?.some(c=>(i=c.call({lexer:this},e,r))?(e=e.substring(i.raw.length),r.push(i),!0):!1))continue;if(i=this.tokenizer.escape(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.tag(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.link(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(i.raw.length);let c=r.at(-1);i.type==="text"&&c?.type==="text"?(c.raw+=i.raw,c.text+=i.text):r.push(i);continue}if(i=this.tokenizer.emStrong(e,o,l)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.codespan(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.br(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.del(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.autolink(e)){e=e.substring(i.raw.length),r.push(i);continue}if(!this.state.inLink&&(i=this.tokenizer.url(e))){e=e.substring(i.raw.length),r.push(i);continue}let u=e;if(this.options.extensions?.startInline){let c=1/0,d=e.slice(1),p;this.options.extensions.startInline.forEach(h=>{p=h.call({lexer:this},d),typeof p=="number"&&p>=0&&(c=Math.min(c,p))}),c<1/0&&c>=0&&(u=e.substring(0,c+1))}if(i=this.tokenizer.inlineText(u)){e=e.substring(i.raw.length),i.raw.slice(-1)!=="_"&&(l=i.raw.slice(-1)),s=!0;let c=r.at(-1);c?.type==="text"?(c.raw+=i.raw,c.text+=i.text):r.push(i);continue}if(e){let c="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(c);break}else throw new Error(c)}}return r}},we=class{options;parser;constructor(t){this.options=t||Z}space(t){return""}code({text:t,lang:e,escaped:r}){let o=(e||"").match(C.notSpaceStart)?.[0],n=t.replace(C.endingNewline,"")+`
`;return o?'<pre><code class="language-'+W(o)+'">'+(r?n:W(n,!0))+`</code></pre>
`:"<pre><code>"+(r?n:W(n,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}def(t){return""}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){let e=t.ordered,r=t.start,o="";for(let s=0;s<t.items.length;s++){let l=t.items[s];o+=this.listitem(l)}let n=e?"ol":"ul",a=e&&r!==1?' start="'+r+'"':"";return"<"+n+a+`>
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
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${W(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:r}){let o=this.parser.parseInline(r),n=Ht(t);if(n===null)return o;t=n;let a='<a href="'+t+'"';return e&&(a+=' title="'+W(e)+'"'),a+=">"+o+"</a>",a}image({href:t,title:e,text:r,tokens:o}){o&&(r=this.parser.parseInline(o,this.parser.textRenderer));let n=Ht(t);if(n===null)return W(r);t=n;let a=`<img src="${t}" alt="${r}"`;return e&&(a+=` title="${W(e)}"`),a+=">",a}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:W(t.text)}},Ge=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}checkbox({raw:t}){return t}},j=class Ye{options;renderer;textRenderer;constructor(e){this.options=e||Z,this.options.renderer=this.options.renderer||new we,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Ge}static parse(e,r){return new Ye(r).parse(e)}static parseInline(e,r){return new Ye(r).parseInline(e)}parse(e){let r="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let s=n,l=this.options.extensions.renderers[s.type].call({parser:this},s);if(l!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(s.type)){r+=l||"";continue}}let a=n;switch(a.type){case"space":{r+=this.renderer.space(a);break}case"hr":{r+=this.renderer.hr(a);break}case"heading":{r+=this.renderer.heading(a);break}case"code":{r+=this.renderer.code(a);break}case"table":{r+=this.renderer.table(a);break}case"blockquote":{r+=this.renderer.blockquote(a);break}case"list":{r+=this.renderer.list(a);break}case"checkbox":{r+=this.renderer.checkbox(a);break}case"html":{r+=this.renderer.html(a);break}case"def":{r+=this.renderer.def(a);break}case"paragraph":{r+=this.renderer.paragraph(a);break}case"text":{r+=this.renderer.text(a);break}default:{let s='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(s),"";throw new Error(s)}}}return r}parseInline(e,r=this.renderer){let o="";for(let n=0;n<e.length;n++){let a=e[n];if(this.options.extensions?.renderers?.[a.type]){let l=this.options.extensions.renderers[a.type].call({parser:this},a);if(l!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){o+=l||"";continue}}let s=a;switch(s.type){case"escape":{o+=r.text(s);break}case"html":{o+=r.html(s);break}case"link":{o+=r.link(s);break}case"image":{o+=r.image(s);break}case"checkbox":{o+=r.checkbox(s);break}case"strong":{o+=r.strong(s);break}case"em":{o+=r.em(s);break}case"codespan":{o+=r.codespan(s);break}case"br":{o+=r.br(s);break}case"del":{o+=r.del(s);break}case"text":{o+=r.text(s);break}default:{let l='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return o}},le=class{options;block;constructor(t){this.options=t||Z}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}emStrongMask(t){return t}provideLexer(){return this.block?q.lex:q.lexInline}provideParser(){return this.block?j.parse:j.parseInline}},Dr=class{defaults=Fe();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=j;Renderer=we;TextRenderer=Ge;Lexer=q;Tokenizer=ye;Hooks=le;constructor(...t){this.use(...t)}walkTokens(t,e){let r=[];for(let o of t)switch(r=r.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let a of n.header)r=r.concat(this.walkTokens(a.tokens,e));for(let a of n.rows)for(let s of a)r=r.concat(this.walkTokens(s.tokens,e));break}case"list":{let n=o;r=r.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(a=>{let s=n[a].flat(1/0);r=r.concat(this.walkTokens(s,e))}):n.tokens&&(r=r.concat(this.walkTokens(n.tokens,e)))}}return r}use(...t){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(r=>{let o={...r};if(o.async=this.defaults.async||o.async||!1,r.extensions&&(r.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let a=e.renderers[n.name];a?e.renderers[n.name]=function(...s){let l=n.renderer.apply(this,s);return l===!1&&(l=a.apply(this,s)),l}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=e[n.level];a?a.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),r.renderer){let n=this.defaults.renderer||new we(this.defaults);for(let a in r.renderer){if(!(a in n))throw new Error(`renderer '${a}' does not exist`);if(["options","parser"].includes(a))continue;let s=a,l=r.renderer[s],i=n[s];n[s]=(...u)=>{let c=l.apply(n,u);return c===!1&&(c=i.apply(n,u)),c||""}}o.renderer=n}if(r.tokenizer){let n=this.defaults.tokenizer||new ye(this.defaults);for(let a in r.tokenizer){if(!(a in n))throw new Error(`tokenizer '${a}' does not exist`);if(["options","rules","lexer"].includes(a))continue;let s=a,l=r.tokenizer[s],i=n[s];n[s]=(...u)=>{let c=l.apply(n,u);return c===!1&&(c=i.apply(n,u)),c}}o.tokenizer=n}if(r.hooks){let n=this.defaults.hooks||new le;for(let a in r.hooks){if(!(a in n))throw new Error(`hook '${a}' does not exist`);if(["options","block"].includes(a))continue;let s=a,l=r.hooks[s],i=n[s];le.passThroughHooks.has(a)?n[s]=u=>{if(this.defaults.async&&le.passThroughHooksRespectAsync.has(a))return(async()=>{let d=await l.call(n,u);return i.call(n,d)})();let c=l.call(n,u);return i.call(n,c)}:n[s]=(...u)=>{if(this.defaults.async)return(async()=>{let d=await l.apply(n,u);return d===!1&&(d=await i.apply(n,u)),d})();let c=l.apply(n,u);return c===!1&&(c=i.apply(n,u)),c}}o.hooks=n}if(r.walkTokens){let n=this.defaults.walkTokens,a=r.walkTokens;o.walkTokens=function(s){let l=[];return l.push(a.call(this,s)),n&&(l=l.concat(n.call(this,s))),l}}this.defaults={...this.defaults,...o}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return q.lex(t,e??this.defaults)}parser(t,e){return j.parse(t,e??this.defaults)}parseMarkdown(t){return(e,r)=>{let o={...r},n={...this.defaults,...o},a=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=t),n.async)return(async()=>{let s=n.hooks?await n.hooks.preprocess(e):e,l=await(n.hooks?await n.hooks.provideLexer():t?q.lex:q.lexInline)(s,n),i=n.hooks?await n.hooks.processAllTokens(l):l;n.walkTokens&&await Promise.all(this.walkTokens(i,n.walkTokens));let u=await(n.hooks?await n.hooks.provideParser():t?j.parse:j.parseInline)(i,n);return n.hooks?await n.hooks.postprocess(u):u})().catch(a);try{n.hooks&&(e=n.hooks.preprocess(e));let s=(n.hooks?n.hooks.provideLexer():t?q.lex:q.lexInline)(e,n);n.hooks&&(s=n.hooks.processAllTokens(s)),n.walkTokens&&this.walkTokens(s,n.walkTokens);let l=(n.hooks?n.hooks.provideParser():t?j.parse:j.parseInline)(s,n);return n.hooks&&(l=n.hooks.postprocess(l)),l}catch(s){return a(s)}}}onError(t,e){return r=>{if(r.message+=`
Please report this to https://github.com/markedjs/marked.`,t){let o="<p>An error occurred:</p><pre>"+W(r.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(r);throw r}}},G=new Dr;function k(t,e){return G.parse(t,e)}k.options=k.setOptions=function(t){return G.setOptions(t),k.defaults=G.defaults,$t(k.defaults),k},k.getDefaults=Fe,k.defaults=Z,k.use=function(...t){return G.use(...t),k.defaults=G.defaults,$t(k.defaults),k},k.walkTokens=function(t,e){return G.walkTokens(t,e)},k.parseInline=G.parseInline,k.Parser=j,k.parser=j.parse,k.Renderer=we,k.TextRenderer=Ge,k.Lexer=q,k.lexer=q.lex,k.Tokenizer=ye,k.Hooks=le,k.parse=k,k.options,k.setOptions,k.use,k.walkTokens,k.parseInline,j.parse,q.lex;function Wr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:g("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function Dt({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),g("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function Or({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"m5 12 7-7 7 7"}),g("path",{d:"M12 19V5"})]})}function Ur({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:g("path",{d:"m6 9 6 6 6-6"})})}function Wt({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:g("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function Ot({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),g("path",{d:"M5 3v4"}),g("path",{d:"M19 17v4"}),g("path",{d:"M3 5h4"}),g("path",{d:"M17 19h4"})]})}function Zr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("polyline",{points:"15 3 21 3 21 9"}),g("polyline",{points:"9 21 3 21 3 15"}),g("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),g("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Gr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("polyline",{points:"4 14 10 14 10 20"}),g("polyline",{points:"20 10 14 10 14 4"}),g("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),g("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Qr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("circle",{cx:"12",cy:"12",r:"10"}),g("path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}),g("path",{d:"M12 17h.01"})]})}function Vr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1"}),g("circle",{cx:"12",cy:"19",r:"0.5",fill:"currentColor"})]})}function Yr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:g("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})})}function Xr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),g("polyline",{points:"14 2 14 8 20 8"})]})}function Kr({className:t}){return g("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[g("circle",{cx:"11",cy:"11",r:"8"}),g("path",{d:"m21 21-4.3-4.3"})]})}k.setOptions({breaks:!0,gfm:!0});const Ut=new k.Renderer;Ut.link=({href:t,title:e,text:r})=>{const o=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${o}>${r}</a>`},k.use({renderer:Ut});function Jr(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function en(t){if(!t)return"";let e=t;return e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\(Source:[^)]*\)/gi,""),e=e.replace(/\[\d+\]/g,""),k.parse(e,{async:!1})}function tn({message:t}){const[e,r]=N(!1),o=t.role==="user",n=t.citations&&t.citations.length>0;return g("div",{className:`grounded-message ${t.role}`,children:[g("div",{className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:o?Jr(t.content):en(t.content)}}),t.isStreaming&&g("span",{className:"grounded-cursor"}),!o&&n&&g("div",{className:"grounded-sources",children:[g("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>r(!e),children:[g(Wt,{}),t.citations.length," source",t.citations.length!==1?"s":"",g(Ur,{})]}),g("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((a,s)=>{const l=a.url?.startsWith("upload://"),i=a.title||(l?"Uploaded Document":a.url)||`Source ${s+1}`;return l?g("div",{className:"grounded-source grounded-source-file",children:[g(Xr,{}),g("span",{className:"grounded-source-title",children:i})]},s):g("a",{href:a.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[g(Wt,{}),g("span",{className:"grounded-source-title",children:i})]},s)})})]})]})}function rn({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return g("div",{className:"grounded-status",children:g("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return g(Kr,{className:"grounded-status-icon"});case"generating":return g(Ot,{className:"grounded-status-icon"});default:return null}})(),g("span",{className:"grounded-status-text",children:e()}),g("div",{className:"grounded-status-dots",children:[g("div",{className:"grounded-typing-dot"}),g("div",{className:"grounded-typing-dot"}),g("div",{className:"grounded-typing-dot"})]})]})})}function Zt({options:t,initialOpen:e=!1,onOpenChange:r}){const{token:o,apiBase:n="",position:a="bottom-right"}=t,[s,l]=N(e),[i,u]=N(!1),[c,d]=N(""),p=K(null),h=K(null),{config:f,isLoading:x}=ar({token:o,apiBase:n}),{messages:y,isLoading:m,chatStatus:b,sendMessage:A}=or({token:o,apiBase:n});ne(()=>{p.current&&p.current.scrollIntoView({behavior:"smooth"})},[y,m]),ne(()=>{s&&h.current&&setTimeout(()=>h.current?.focus(),100)},[s]);const z=K(!1);ne(()=>{z.current&&!m&&s&&setTimeout(()=>h.current?.focus(),50),z.current=m},[m,s]),ne(()=>{r?.(s)},[s,r]);const T=()=>{l(!s)},R=()=>{c.trim()&&!m&&(A(c),d(""),h.current&&(h.current.style.height="auto"),setTimeout(()=>{h.current?.focus()},50))},E=P=>{P.key==="Enter"&&!P.shiftKey&&(P.preventDefault(),R())},M=P=>{const ze=P.target;d(ze.value),ze.style.height="auto",ze.style.height=Math.min(ze.scrollHeight,120)+"px"},B=a==="bottom-left",I=f?.agentName||"Assistant",L=f?.welcomeMessage||"How can I help?",F=f?.description||"Ask me anything. I'm here to assist you.",Q=f?.logoUrl,V=y.length===0&&!m,Se=f?.theme?.buttonStyle||"circle",$e=f?.theme?.buttonSize||"medium",de=f?.theme?.buttonText||"Chat with us",$=f?.theme?.buttonIcon||"chat",H=f?.theme?.buttonColor||"#2563eb",O=f?.theme?.customIconUrl,J=f?.theme?.customIconSize,ln=()=>{if(O){const P=J?{"--custom-icon-size":`${J}px`}:void 0;return g("img",{src:O,alt:"",className:"grounded-launcher-custom-icon",style:P})}switch($){case"help":return g(Qr,{});case"question":return g(Vr,{});case"message":return g(Yr,{});default:return g(Wr,{})}};return g("div",{className:`grounded-container ${B?"left":""}`,children:[g("div",{className:`grounded-window ${s?"open":""} ${i?"expanded":""}`,children:[g("div",{className:"grounded-header",children:[g("div",{className:"grounded-header-left",children:[Q&&g("img",{src:Q,alt:"",className:"grounded-header-logo"}),g("h2",{className:"grounded-header-title",children:I})]}),g("div",{className:"grounded-header-actions",children:[g("button",{className:"grounded-header-btn",onClick:()=>u(!i),"aria-label":i?"Shrink chat":"Expand chat",children:i?g(Gr,{}):g(Zr,{})}),g("button",{className:"grounded-header-btn",onClick:T,"aria-label":"Close chat",children:g(Dt,{})})]})]}),g("div",{className:"grounded-messages",children:[V?g("div",{className:"grounded-empty",children:[g(Ot,{className:"grounded-empty-icon"}),g("h3",{className:"grounded-empty-title",children:F}),g("p",{className:"grounded-empty-text",children:L})]}):g(Y,{children:[y.filter(P=>P.content||P.role==="user").map(P=>g(tn,{message:P},P.id)),(m||b.status!=="idle")&&b.status!=="streaming"&&g(rn,{status:b})]}),g("div",{ref:p})]}),g("div",{className:"grounded-input-area",children:g("div",{className:"grounded-input-container",children:[g("textarea",{ref:h,className:"grounded-input",placeholder:x?"Loading...":"Type a message...",value:c,onInput:M,onKeyDown:E,rows:1,disabled:m||x}),g("button",{className:"grounded-send",onClick:R,disabled:!c.trim()||m||x,"aria-label":"Send message",children:g(Or,{})})]})}),g("div",{className:"grounded-footer",children:["Powered by ",g("a",{href:"https://grounded.ai",target:"_blank",rel:"noopener",children:"Grounded"})]})]}),g("button",{className:`grounded-launcher grounded-launcher--${Se} grounded-launcher--${$e} ${s?"open":""}`,onClick:T,"aria-label":s?"Close chat":"Open chat",style:{backgroundColor:H},children:s?g(Dt,{}):g(Y,{children:[ln(),Se==="pill"&&g("span",{className:"grounded-launcher-text",children:de})]})})]})}const nn=`
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
`;function on(t){const{containerId:e,containerStyle:r="",colorScheme:o="auto"}=t,n=document.createElement("div");n.id=e,r&&(n.style.cssText=r),document.body.appendChild(n);const a=n.attachShadow({mode:"open"}),s=document.createElement("style");s.textContent=nn,a.appendChild(s),an(n,o);let l=null,i=null;o==="auto"&&(l=window.matchMedia("(prefers-color-scheme: dark)"),i=()=>{console.log("[Grounded] System theme changed")},l.addEventListener("change",i));const u=document.createElement("div");return u.style.cssText="height:100%;width:100%;",a.appendChild(u),{container:n,shadowRoot:a,mountPoint:u,cleanup:()=>{l&&i&&l.removeEventListener("change",i),n.remove()}}}function an(t,e){t.classList.remove("light","dark"),e==="light"?t.classList.add("light"):e==="dark"&&t.classList.add("dark")}class sn{constructor(){this.context=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.processQueue()}processQueue(){const e=window.grounded?.q||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,r){switch(e){case"init":this.init(r);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[Grounded Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[Grounded Widget] Already initialized");return}if(!e?.token){console.error("[Grounded Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase(),colorScheme:e.colorScheme||"auto"},this.context=on({containerId:"grounded-widget-root",colorScheme:this.options.colorScheme}),gt(g(Zt,{options:this.options,initialOpen:this.openState,onOpenChange:r=>{this.openState=r,this.openCallback?.(r)}}),this.context.mountPoint),this.isInitialized=!0,console.log("[Grounded Widget] Initialized with colorScheme:",this.options.colorScheme)}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const r of e){const o=r.getAttribute("src");if(o)try{return new URL(o,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){!this.context||!this.options||gt(g(Zt,{options:this.options,initialOpen:this.openState,onOpenChange:e=>{this.openState=e,this.openCallback?.(e)}}),this.context.mountPoint)}destroy(){this.context&&(this.context.cleanup(),this.context=null),this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[Grounded Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const Qe=new sn;function Gt(t,e){Qe.handleCommand(t,e)}return window.grounded=Gt,window.GroundedWidget=Qe,ue.GroundedWidget=Qe,ue.grounded=Gt,Object.defineProperty(ue,Symbol.toStringTag,{value:"Module"}),ue})({});
