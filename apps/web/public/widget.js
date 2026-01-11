var KCBWidget=function(F){"use strict";var Qn=Object.defineProperty;var Yn=(F,P,_)=>P in F?Qn(F,P,{enumerable:!0,configurable:!0,writable:!0,value:_}):F[P]=_;var S=(F,P,_)=>Yn(F,typeof P!="symbol"?P+"":P,_);var De;var P,_,Ze,U,Ge,Ke,Qe,Ye,me,xe,ve,Y={},Ve=[],Dt=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,se=Array.isArray;function D(t,e){for(var n in e)t[n]=e[n];return t}function we(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function jt(t,e,n){var r,s,i,l={};for(i in e)i=="key"?r=e[i]:i=="ref"?s=e[i]:l[i]=e[i];if(arguments.length>2&&(l.children=arguments.length>3?P.call(arguments,2):n),typeof t=="function"&&t.defaultProps!=null)for(i in t.defaultProps)l[i]===void 0&&(l[i]=t.defaultProps[i]);return ie(t,l,r,s,null)}function ie(t,e,n,r,s){var i={type:t,props:e,key:n,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:s??++Ze,__i:-1,__u:0};return s==null&&_.vnode!=null&&_.vnode(i),i}function V(t){return t.children}function ae(t,e){this.props=t,this.context=e}function Q(t,e){if(e==null)return t.__?Q(t.__,t.__i+1):null;for(var n;e<t.__k.length;e++)if((n=t.__k[e])!=null&&n.__e!=null)return n.__e;return typeof t.type=="function"?Q(t):null}function Xe(t){var e,n;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((n=t.__k[e])!=null&&n.__e!=null){t.__e=t.__c.base=n.__e;break}return Xe(t)}}function Je(t){(!t.__d&&(t.__d=!0)&&U.push(t)&&!oe.__r++||Ge!=_.debounceRendering)&&((Ge=_.debounceRendering)||Ke)(oe)}function oe(){for(var t,e,n,r,s,i,l,a=1;U.length;)U.length>a&&U.sort(Qe),t=U.shift(),a=U.length,t.__d&&(n=void 0,r=void 0,s=(r=(e=t).__v).__e,i=[],l=[],e.__P&&((n=D({},r)).__v=r.__v+1,_.vnode&&_.vnode(n),ye(e.__P,n,r,e.__n,e.__P.namespaceURI,32&r.__u?[s]:null,i,s??Q(r),!!(32&r.__u),l),n.__v=r.__v,n.__.__k[n.__i]=n,st(i,n,l),r.__e=r.__=null,n.__e!=s&&Xe(n)));oe.__r=0}function et(t,e,n,r,s,i,l,a,p,o,c){var u,h,b,f,x,v,k,g=r&&r.__k||Ve,A=e.length;for(p=Wt(n,e,g,p,A),u=0;u<A;u++)(b=n.__k[u])!=null&&(h=b.__i==-1?Y:g[b.__i]||Y,b.__i=u,v=ye(t,b,h,s,i,l,a,p,o,c),f=b.__e,b.ref&&h.ref!=b.ref&&(h.ref&&$e(h.ref,null,b),c.push(b.ref,b.__c||f,b)),x==null&&f!=null&&(x=f),(k=!!(4&b.__u))||h.__k===b.__k?p=tt(b,p,t,k):typeof b.type=="function"&&v!==void 0?p=v:f&&(p=f.nextSibling),b.__u&=-7);return n.__e=x,p}function Wt(t,e,n,r,s){var i,l,a,p,o,c=n.length,u=c,h=0;for(t.__k=new Array(s),i=0;i<s;i++)(l=e[i])!=null&&typeof l!="boolean"&&typeof l!="function"?(typeof l=="string"||typeof l=="number"||typeof l=="bigint"||l.constructor==String?l=t.__k[i]=ie(null,l,null,null,null):se(l)?l=t.__k[i]=ie(V,{children:l},null,null,null):l.constructor===void 0&&l.__b>0?l=t.__k[i]=ie(l.type,l.props,l.key,l.ref?l.ref:null,l.__v):t.__k[i]=l,p=i+h,l.__=t,l.__b=t.__b+1,a=null,(o=l.__i=Ot(l,n,p,u))!=-1&&(u--,(a=n[o])&&(a.__u|=2)),a==null||a.__v==null?(o==-1&&(s>c?h--:s<c&&h++),typeof l.type!="function"&&(l.__u|=4)):o!=p&&(o==p-1?h--:o==p+1?h++:(o>p?h--:h++,l.__u|=4))):t.__k[i]=null;if(u)for(i=0;i<c;i++)(a=n[i])!=null&&!(2&a.__u)&&(a.__e==r&&(r=Q(a)),at(a,a));return r}function tt(t,e,n,r){var s,i;if(typeof t.type=="function"){for(s=t.__k,i=0;s&&i<s.length;i++)s[i]&&(s[i].__=t,e=tt(s[i],e,n,r));return e}t.__e!=e&&(r&&(e&&t.type&&!e.parentNode&&(e=Q(t)),n.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function Ot(t,e,n,r){var s,i,l,a=t.key,p=t.type,o=e[n],c=o!=null&&(2&o.__u)==0;if(o===null&&a==null||c&&a==o.key&&p==o.type)return n;if(r>(c?1:0)){for(s=n-1,i=n+1;s>=0||i<e.length;)if((o=e[l=s>=0?s--:i++])!=null&&!(2&o.__u)&&a==o.key&&p==o.type)return l}return-1}function nt(t,e,n){e[0]=="-"?t.setProperty(e,n??""):t[e]=n==null?"":typeof n!="number"||Dt.test(e)?n:n+"px"}function le(t,e,n,r,s){var i,l;e:if(e=="style")if(typeof n=="string")t.style.cssText=n;else{if(typeof r=="string"&&(t.style.cssText=r=""),r)for(e in r)n&&e in n||nt(t.style,e,"");if(n)for(e in n)r&&n[e]==r[e]||nt(t.style,e,n[e])}else if(e[0]=="o"&&e[1]=="n")i=e!=(e=e.replace(Ye,"$1")),l=e.toLowerCase(),e=l in t||e=="onFocusOut"||e=="onFocusIn"?l.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+i]=n,n?r?n.u=r.u:(n.u=me,t.addEventListener(e,i?ve:xe,i)):t.removeEventListener(e,i?ve:xe,i);else{if(s=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=n??"";break e}catch{}typeof n=="function"||(n==null||n===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&n==1?"":n))}}function rt(t){return function(e){if(this.l){var n=this.l[e.type+t];if(e.t==null)e.t=me++;else if(e.t<n.u)return;return n(_.event?_.event(e):e)}}}function ye(t,e,n,r,s,i,l,a,p,o){var c,u,h,b,f,x,v,k,g,A,R,I,E,T,q,N,O,z=e.type;if(e.constructor!==void 0)return null;128&n.__u&&(p=!!(32&n.__u),i=[a=e.__e=n.__e]),(c=_.__b)&&c(e);e:if(typeof z=="function")try{if(k=e.props,g="prototype"in z&&z.prototype.render,A=(c=z.contextType)&&r[c.__c],R=c?A?A.props.value:c.__:r,n.__c?v=(u=e.__c=n.__c).__=u.__E:(g?e.__c=u=new z(k,R):(e.__c=u=new ae(k,R),u.constructor=z,u.render=Zt),A&&A.sub(u),u.state||(u.state={}),u.__n=r,h=u.__d=!0,u.__h=[],u._sb=[]),g&&u.__s==null&&(u.__s=u.state),g&&z.getDerivedStateFromProps!=null&&(u.__s==u.state&&(u.__s=D({},u.__s)),D(u.__s,z.getDerivedStateFromProps(k,u.__s))),b=u.props,f=u.state,u.__v=e,h)g&&z.getDerivedStateFromProps==null&&u.componentWillMount!=null&&u.componentWillMount(),g&&u.componentDidMount!=null&&u.__h.push(u.componentDidMount);else{if(g&&z.getDerivedStateFromProps==null&&k!==b&&u.componentWillReceiveProps!=null&&u.componentWillReceiveProps(k,R),e.__v==n.__v||!u.__e&&u.shouldComponentUpdate!=null&&u.shouldComponentUpdate(k,u.__s,R)===!1){for(e.__v!=n.__v&&(u.props=k,u.state=u.__s,u.__d=!1),e.__e=n.__e,e.__k=n.__k,e.__k.some(function(y){y&&(y.__=e)}),I=0;I<u._sb.length;I++)u.__h.push(u._sb[I]);u._sb=[],u.__h.length&&l.push(u);break e}u.componentWillUpdate!=null&&u.componentWillUpdate(k,u.__s,R),g&&u.componentDidUpdate!=null&&u.__h.push(function(){u.componentDidUpdate(b,f,x)})}if(u.context=R,u.props=k,u.__P=t,u.__e=!1,E=_.__r,T=0,g){for(u.state=u.__s,u.__d=!1,E&&E(e),c=u.render(u.props,u.state,u.context),q=0;q<u._sb.length;q++)u.__h.push(u._sb[q]);u._sb=[]}else do u.__d=!1,E&&E(e),c=u.render(u.props,u.state,u.context),u.state=u.__s;while(u.__d&&++T<25);u.state=u.__s,u.getChildContext!=null&&(r=D(D({},r),u.getChildContext())),g&&!h&&u.getSnapshotBeforeUpdate!=null&&(x=u.getSnapshotBeforeUpdate(b,f)),N=c,c!=null&&c.type===V&&c.key==null&&(N=it(c.props.children)),a=et(t,se(N)?N:[N],e,n,r,s,i,l,a,p,o),u.base=e.__e,e.__u&=-161,u.__h.length&&l.push(u),v&&(u.__E=u.__=null)}catch(y){if(e.__v=null,p||i!=null)if(y.then){for(e.__u|=p?160:128;a&&a.nodeType==8&&a.nextSibling;)a=a.nextSibling;i[i.indexOf(a)]=null,e.__e=a}else{for(O=i.length;O--;)we(i[O]);Se(e)}else e.__e=n.__e,e.__k=n.__k,y.then||Se(e);_.__e(y,e,n)}else i==null&&e.__v==n.__v?(e.__k=n.__k,e.__e=n.__e):a=e.__e=Ut(n.__e,e,n,r,s,i,l,p,o);return(c=_.diffed)&&c(e),128&e.__u?void 0:a}function Se(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Se)}function st(t,e,n){for(var r=0;r<n.length;r++)$e(n[r],n[++r],n[++r]);_.__c&&_.__c(e,t),t.some(function(s){try{t=s.__h,s.__h=[],t.some(function(i){i.call(s)})}catch(i){_.__e(i,s.__v)}})}function it(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:se(t)?t.map(it):D({},t)}function Ut(t,e,n,r,s,i,l,a,p){var o,c,u,h,b,f,x,v=n.props||Y,k=e.props,g=e.type;if(g=="svg"?s="http://www.w3.org/2000/svg":g=="math"?s="http://www.w3.org/1998/Math/MathML":s||(s="http://www.w3.org/1999/xhtml"),i!=null){for(o=0;o<i.length;o++)if((b=i[o])&&"setAttribute"in b==!!g&&(g?b.localName==g:b.nodeType==3)){t=b,i[o]=null;break}}if(t==null){if(g==null)return document.createTextNode(k);t=document.createElementNS(s,g,k.is&&k),a&&(_.__m&&_.__m(e,i),a=!1),i=null}if(g==null)v===k||a&&t.data==k||(t.data=k);else{if(i=i&&P.call(t.childNodes),!a&&i!=null)for(v={},o=0;o<t.attributes.length;o++)v[(b=t.attributes[o]).name]=b.value;for(o in v)if(b=v[o],o!="children"){if(o=="dangerouslySetInnerHTML")u=b;else if(!(o in k)){if(o=="value"&&"defaultValue"in k||o=="checked"&&"defaultChecked"in k)continue;le(t,o,null,b,s)}}for(o in k)b=k[o],o=="children"?h=b:o=="dangerouslySetInnerHTML"?c=b:o=="value"?f=b:o=="checked"?x=b:a&&typeof b!="function"||v[o]===b||le(t,o,b,v[o],s);if(c)a||u&&(c.__html==u.__html||c.__html==t.innerHTML)||(t.innerHTML=c.__html),e.__k=[];else if(u&&(t.innerHTML=""),et(e.type=="template"?t.content:t,se(h)?h:[h],e,n,r,g=="foreignObject"?"http://www.w3.org/1999/xhtml":s,i,l,i?i[0]:n.__k&&Q(n,0),a,p),i!=null)for(o=i.length;o--;)we(i[o]);a||(o="value",g=="progress"&&f==null?t.removeAttribute("value"):f!=null&&(f!==t[o]||g=="progress"&&!f||g=="option"&&f!=v[o])&&le(t,o,f,v[o],s),o="checked",x!=null&&x!=t[o]&&le(t,o,x,v[o],s))}return t}function $e(t,e,n){try{if(typeof t=="function"){var r=typeof t.__u=="function";r&&t.__u(),r&&e==null||(t.__u=t(e))}else t.current=e}catch(s){_.__e(s,n)}}function at(t,e,n){var r,s;if(_.unmount&&_.unmount(t),(r=t.ref)&&(r.current&&r.current!=t.__e||$e(r,null,e)),(r=t.__c)!=null){if(r.componentWillUnmount)try{r.componentWillUnmount()}catch(i){_.__e(i,e)}r.base=r.__P=null}if(r=t.__k)for(s=0;s<r.length;s++)r[s]&&at(r[s],e,n||typeof t.type!="function");n||we(t.__e),t.__c=t.__=t.__e=void 0}function Zt(t,e,n){return this.constructor(t,n)}function ot(t,e,n){var r,s,i,l;e==document&&(e=document.documentElement),_.__&&_.__(t,e),s=(r=!1)?null:e.__k,i=[],l=[],ye(e,t=e.__k=jt(V,null,[t]),s||Y,Y,e.namespaceURI,s?null:e.firstChild?P.call(e.childNodes):null,i,s?s.__e:e.firstChild,r,l),st(i,t,l)}P=Ve.slice,_={__e:function(t,e,n,r){for(var s,i,l;e=e.__;)if((s=e.__c)&&!s.__)try{if((i=s.constructor)&&i.getDerivedStateFromError!=null&&(s.setState(i.getDerivedStateFromError(t)),l=s.__d),s.componentDidCatch!=null&&(s.componentDidCatch(t,r||{}),l=s.__d),l)return s.__E=s}catch(a){t=a}throw t}},Ze=0,ae.prototype.setState=function(t,e){var n;n=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=D({},this.state),typeof t=="function"&&(t=t(D({},n),this.props)),t&&D(n,t),t!=null&&this.__v&&(e&&this._sb.push(e),Je(this))},ae.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),Je(this))},ae.prototype.render=V,U=[],Ke=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,Qe=function(t,e){return t.__v.__b-e.__v.__b},oe.__r=0,Ye=/(PointerCapture)$|Capture$/i,me=0,xe=rt(!1),ve=rt(!0);var Gt=0;function d(t,e,n,r,s,i){e||(e={});var l,a,p=e;if("ref"in p)for(a in p={},e)a=="ref"?l=e[a]:p[a]=e[a];var o={type:t,props:p,key:n,ref:l,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--Gt,__i:-1,__u:0,__source:s,__self:i};if(typeof t=="function"&&(l=t.defaultProps))for(a in l)p[a]===void 0&&(p[a]=l[a]);return _.vnode&&_.vnode(o),o}var X,$,Re,lt,J=0,ct=[],C=_,ut=C.__b,pt=C.__r,ht=C.diffed,dt=C.__c,bt=C.unmount,ft=C.__;function Ce(t,e){C.__h&&C.__h($,t,J||e),J=0;var n=$.__H||($.__H={__:[],__h:[]});return t>=n.__.length&&n.__.push({}),n.__[t]}function B(t){return J=1,Kt(mt,t)}function Kt(t,e,n){var r=Ce(X++,2);if(r.t=t,!r.__c&&(r.__=[mt(void 0,e),function(a){var p=r.__N?r.__N[0]:r.__[0],o=r.t(p,a);p!==o&&(r.__N=[o,r.__[1]],r.__c.setState({}))}],r.__c=$,!$.__f)){var s=function(a,p,o){if(!r.__c.__H)return!0;var c=r.__c.__H.__.filter(function(h){return!!h.__c});if(c.every(function(h){return!h.__N}))return!i||i.call(this,a,p,o);var u=r.__c.props!==a;return c.forEach(function(h){if(h.__N){var b=h.__[0];h.__=h.__N,h.__N=void 0,b!==h.__[0]&&(u=!0)}}),i&&i.call(this,a,p,o)||u};$.__f=!0;var i=$.shouldComponentUpdate,l=$.componentWillUpdate;$.componentWillUpdate=function(a,p,o){if(this.__e){var c=i;i=void 0,s(a,p,o),i=c}l&&l.call(this,a,p,o)},$.shouldComponentUpdate=s}return r.__N||r.__}function ce(t,e){var n=Ce(X++,3);!C.__s&&_t(n.__H,e)&&(n.__=t,n.u=e,$.__H.__h.push(n))}function ue(t){return J=5,gt(function(){return{current:t}},[])}function gt(t,e){var n=Ce(X++,7);return _t(n.__H,e)&&(n.__=t(),n.__H=e,n.__h=t),n.__}function ze(t,e){return J=8,gt(function(){return t},e)}function Qt(){for(var t;t=ct.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(pe),t.__H.__h.forEach(Te),t.__H.__h=[]}catch(e){t.__H.__h=[],C.__e(e,t.__v)}}C.__b=function(t){$=null,ut&&ut(t)},C.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),ft&&ft(t,e)},C.__r=function(t){pt&&pt(t),X=0;var e=($=t.__c).__H;e&&(Re===$?(e.__h=[],$.__h=[],e.__.forEach(function(n){n.__N&&(n.__=n.__N),n.u=n.__N=void 0})):(e.__h.forEach(pe),e.__h.forEach(Te),e.__h=[],X=0)),Re=$},C.diffed=function(t){ht&&ht(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(ct.push(e)!==1&&lt===C.requestAnimationFrame||((lt=C.requestAnimationFrame)||Yt)(Qt)),e.__H.__.forEach(function(n){n.u&&(n.__H=n.u),n.u=void 0})),Re=$=null},C.__c=function(t,e){e.some(function(n){try{n.__h.forEach(pe),n.__h=n.__h.filter(function(r){return!r.__||Te(r)})}catch(r){e.some(function(s){s.__h&&(s.__h=[])}),e=[],C.__e(r,n.__v)}}),dt&&dt(t,e)},C.unmount=function(t){bt&&bt(t);var e,n=t.__c;n&&n.__H&&(n.__H.__.forEach(function(r){try{pe(r)}catch(s){e=s}}),n.__H=void 0,e&&C.__e(e,n.__v))};var kt=typeof requestAnimationFrame=="function";function Yt(t){var e,n=function(){clearTimeout(r),kt&&cancelAnimationFrame(e),setTimeout(t)},r=setTimeout(n,35);kt&&(e=requestAnimationFrame(n))}function pe(t){var e=$,n=t.__c;typeof n=="function"&&(t.__c=void 0,n()),$=e}function Te(t){var e=$;t.__c=t.__(),$=e}function _t(t,e){return!t||t.length!==e.length||e.some(function(n,r){return n!==t[r]})}function mt(t,e){return typeof e=="function"?e(t):e}function Vt({token:t,apiBase:e}){const[n,r]=B([]),[s,i]=B(!1),[l,a]=B(!1),[p,o]=B(null),c=ue(typeof sessionStorage<"u"?sessionStorage.getItem(`kcb_conv_${t}`):null),u=ue(null),h=()=>Math.random().toString(36).slice(2,11),b=ze(async v=>{var A;if(!v.trim()||s||l)return;const k={id:h(),role:"user",content:v.trim(),timestamp:Date.now()},g=h();r(R=>[...R,k]),i(!0),a(!0),o(null),u.current=new AbortController;try{const R={message:v.trim()};c.current&&(R.conversationId=c.current);const I=await fetch(`${e}/api/v1/widget/${t}/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(R),signal:u.current.signal});if(!I.ok){const z=await I.json().catch(()=>({}));throw new Error(z.message||`Request failed: ${I.status}`)}r(z=>[...z,{id:g,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),i(!1);const E=(A=I.body)==null?void 0:A.getReader();if(!E)throw new Error("No response body");const T=new TextDecoder;let q="",N="",O=[];for(;;){const{done:z,value:y}=await E.read();if(z)break;q+=T.decode(y,{stream:!0});const K=q.split(`
`);q=K.pop()||"";for(const je of K)if(je.startsWith("data: "))try{const M=JSON.parse(je.slice(6));if(M.type==="text"&&M.content)N+=M.content,r(Kn=>Kn.map(We=>We.id===g?{...We,content:N}:We));else if(M.type==="done"){if(M.conversationId){c.current=M.conversationId;try{sessionStorage.setItem(`kcb_conv_${t}`,M.conversationId)}catch{}}O=M.citations||[]}else if(M.type==="error")throw new Error(M.message||"Stream error")}catch{console.warn("[KCB Widget] Failed to parse SSE:",je)}}r(z=>z.map(y=>y.id===g?{...y,content:N,isStreaming:!1,citations:O}:y))}catch(R){if(R.name==="AbortError")return;o(R instanceof Error?R.message:"An error occurred"),r(I=>I.some(T=>T.id===g)?I.map(T=>T.id===g?{...T,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:T):[...I,{id:g,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{i(!1),a(!1),u.current=null}},[t,e,s,l]),f=ze(()=>{u.current&&(u.current.abort(),u.current=null),a(!1),i(!1)},[]),x=ze(()=>{r([]),c.current=null;try{sessionStorage.removeItem(`kcb_conv_${t}`)}catch{}},[t]);return{messages:n,isLoading:s,isStreaming:l,error:p,sendMessage:b,stopStreaming:f,clearMessages:x}}function Xt({token:t,apiBase:e}){const[n,r]=B(null),[s,i]=B(!0),[l,a]=B(null);return ce(()=>{async function p(){try{const o=await fetch(`${e}/api/v1/widget/${t}/config`);if(!o.ok)throw new Error("Failed to load widget configuration");const c=await o.json();r(c)}catch(o){a(o instanceof Error?o.message:"Configuration error"),r({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0})}finally{i(!1)}}p()},[t,e]),{config:n,isLoading:s,error:l}}function Ae(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var Z=Ae();function xt(t){Z=t}var ee={exec:()=>null};function w(t,e=""){let n=typeof t=="string"?t:t.source;const r={replace:(s,i)=>{let l=typeof i=="string"?i:i.source;return l=l.replace(L.caret,"$1"),n=n.replace(s,l),r},getRegex:()=>new RegExp(n,e)};return r}var L={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] /,listReplaceTask:/^\[[ xX]\] +/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},Jt=/^(?:[ \t]*(?:\n|$))+/,en=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,tn=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,te=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,nn=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Ie=/(?:[*+-]|\d{1,9}[.)])/,vt=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,wt=w(vt).replace(/bull/g,Ie).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),rn=w(vt).replace(/bull/g,Ie).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Le=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,sn=/^[^\n]+/,Ee=/(?!\s*\])(?:\\.|[^\[\]\\])+/,an=w(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",Ee).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),on=w(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Ie).getRegex(),he="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Pe=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,ln=w("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",Pe).replace("tag",he).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),yt=w(Le).replace("hr",te).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",he).getRegex(),cn=w(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",yt).getRegex(),Be={blockquote:cn,code:en,def:an,fences:tn,heading:nn,hr:te,html:ln,lheading:wt,list:on,newline:Jt,paragraph:yt,table:ee,text:sn},St=w("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",te).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",he).getRegex(),un={...Be,lheading:rn,table:St,paragraph:w(Le).replace("hr",te).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",St).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",he).getRegex()},pn={...Be,html:w(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",Pe).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:ee,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:w(Le).replace("hr",te).replace("heading",` *#{1,6} *[^
]`).replace("lheading",wt).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},hn=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,dn=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,$t=/^( {2,}|\\)\n(?!\s*$)/,bn=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,de=/[\p{P}\p{S}]/u,Ne=/[\s\p{P}\p{S}]/u,Rt=/[^\s\p{P}\p{S}]/u,fn=w(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Ne).getRegex(),Ct=/(?!~)[\p{P}\p{S}]/u,gn=/(?!~)[\s\p{P}\p{S}]/u,kn=/(?:[^\s\p{P}\p{S}]|~)/u,_n=/\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g,zt=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,mn=w(zt,"u").replace(/punct/g,de).getRegex(),xn=w(zt,"u").replace(/punct/g,Ct).getRegex(),Tt="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",vn=w(Tt,"gu").replace(/notPunctSpace/g,Rt).replace(/punctSpace/g,Ne).replace(/punct/g,de).getRegex(),wn=w(Tt,"gu").replace(/notPunctSpace/g,kn).replace(/punctSpace/g,gn).replace(/punct/g,Ct).getRegex(),yn=w("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Rt).replace(/punctSpace/g,Ne).replace(/punct/g,de).getRegex(),Sn=w(/\\(punct)/,"gu").replace(/punct/g,de).getRegex(),$n=w(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Rn=w(Pe).replace("(?:-->|$)","-->").getRegex(),Cn=w("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Rn).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),be=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/,zn=w(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",be).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),At=w(/^!?\[(label)\]\[(ref)\]/).replace("label",be).replace("ref",Ee).getRegex(),It=w(/^!?\[(ref)\](?:\[\])?/).replace("ref",Ee).getRegex(),Tn=w("reflink|nolink(?!\\()","g").replace("reflink",At).replace("nolink",It).getRegex(),Me={_backpedal:ee,anyPunctuation:Sn,autolink:$n,blockSkip:_n,br:$t,code:dn,del:ee,emStrongLDelim:mn,emStrongRDelimAst:vn,emStrongRDelimUnd:yn,escape:hn,link:zn,nolink:It,punctuation:fn,reflink:At,reflinkSearch:Tn,tag:Cn,text:bn,url:ee},An={...Me,link:w(/^!?\[(label)\]\((.*?)\)/).replace("label",be).getRegex(),reflink:w(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",be).getRegex()},Fe={...Me,emStrongRDelimAst:wn,emStrongLDelim:xn,url:w(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,"i").replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/},In={...Fe,br:w($t).replace("{2,}","*").getRegex(),text:w(Fe.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},fe={normal:Be,gfm:un,pedantic:pn},ne={normal:Me,gfm:Fe,breaks:In,pedantic:An},Ln={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Lt=t=>Ln[t];function H(t,e){if(e){if(L.escapeTest.test(t))return t.replace(L.escapeReplace,Lt)}else if(L.escapeTestNoEncode.test(t))return t.replace(L.escapeReplaceNoEncode,Lt);return t}function Et(t){try{t=encodeURI(t).replace(L.percentDecode,"%")}catch{return null}return t}function Pt(t,e){var i;const n=t.replace(L.findPipe,(l,a,p)=>{let o=!1,c=a;for(;--c>=0&&p[c]==="\\";)o=!o;return o?"|":" |"}),r=n.split(L.splitPipe);let s=0;if(r[0].trim()||r.shift(),r.length>0&&!((i=r.at(-1))!=null&&i.trim())&&r.pop(),e)if(r.length>e)r.splice(e);else for(;r.length<e;)r.push("");for(;s<r.length;s++)r[s]=r[s].trim().replace(L.slashPipe,"|");return r}function re(t,e,n){const r=t.length;if(r===0)return"";let s=0;for(;s<r&&t.charAt(r-s-1)===e;)s++;return t.slice(0,r-s)}function En(t,e){if(t.indexOf(e[1])===-1)return-1;let n=0;for(let r=0;r<t.length;r++)if(t[r]==="\\")r++;else if(t[r]===e[0])n++;else if(t[r]===e[1]&&(n--,n<0))return r;return n>0?-2:-1}function Bt(t,e,n,r,s){const i=e.href,l=e.title||null,a=t[1].replace(s.other.outputLinkReplace,"$1");r.state.inLink=!0;const p={type:t[0].charAt(0)==="!"?"image":"link",raw:n,href:i,title:l,text:a,tokens:r.inlineTokens(a)};return r.state.inLink=!1,p}function Pn(t,e,n){const r=t.match(n.other.indentCodeCompensation);if(r===null)return e;const s=r[1];return e.split(`
`).map(i=>{const l=i.match(n.other.beginningSpace);if(l===null)return i;const[a]=l;return a.length>=s.length?i.slice(s.length):i}).join(`
`)}var ge=class{constructor(t){S(this,"options");S(this,"rules");S(this,"lexer");this.options=t||Z}space(t){const e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){const e=this.rules.block.code.exec(t);if(e){const n=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?n:re(n,`
`)}}}fences(t){const e=this.rules.block.fences.exec(t);if(e){const n=e[0],r=Pn(n,e[3]||"",this.rules);return{type:"code",raw:n,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:r}}}heading(t){const e=this.rules.block.heading.exec(t);if(e){let n=e[2].trim();if(this.rules.other.endingHash.test(n)){const r=re(n,"#");(this.options.pedantic||!r||this.rules.other.endingSpaceChar.test(r))&&(n=r.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(t){const e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:re(e[0],`
`)}}blockquote(t){const e=this.rules.block.blockquote.exec(t);if(e){let n=re(e[0],`
`).split(`
`),r="",s="";const i=[];for(;n.length>0;){let l=!1;const a=[];let p;for(p=0;p<n.length;p++)if(this.rules.other.blockquoteStart.test(n[p]))a.push(n[p]),l=!0;else if(!l)a.push(n[p]);else break;n=n.slice(p);const o=a.join(`
`),c=o.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");r=r?`${r}
${o}`:o,s=s?`${s}
${c}`:c;const u=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(c,i,!0),this.lexer.state.top=u,n.length===0)break;const h=i.at(-1);if((h==null?void 0:h.type)==="code")break;if((h==null?void 0:h.type)==="blockquote"){const b=h,f=b.raw+`
`+n.join(`
`),x=this.blockquote(f);i[i.length-1]=x,r=r.substring(0,r.length-b.raw.length)+x.raw,s=s.substring(0,s.length-b.text.length)+x.text;break}else if((h==null?void 0:h.type)==="list"){const b=h,f=b.raw+`
`+n.join(`
`),x=this.list(f);i[i.length-1]=x,r=r.substring(0,r.length-h.raw.length)+x.raw,s=s.substring(0,s.length-b.raw.length)+x.raw,n=f.substring(i.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:r,tokens:i,text:s}}}list(t){let e=this.rules.block.list.exec(t);if(e){let n=e[1].trim();const r=n.length>1,s={type:"list",raw:"",ordered:r,start:r?+n.slice(0,-1):"",loose:!1,items:[]};n=r?`\\d{1,9}\\${n.slice(-1)}`:`\\${n}`,this.options.pedantic&&(n=r?n:"[*+-]");const i=this.rules.other.listItemRegex(n);let l=!1;for(;t;){let p=!1,o="",c="";if(!(e=i.exec(t))||this.rules.block.hr.test(t))break;o=e[0],t=t.substring(o.length);let u=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,k=>" ".repeat(3*k.length)),h=t.split(`
`,1)[0],b=!u.trim(),f=0;if(this.options.pedantic?(f=2,c=u.trimStart()):b?f=e[1].length+1:(f=e[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,c=u.slice(f),f+=e[1].length),b&&this.rules.other.blankLine.test(h)&&(o+=h+`
`,t=t.substring(h.length+1),p=!0),!p){const k=this.rules.other.nextBulletRegex(f),g=this.rules.other.hrRegex(f),A=this.rules.other.fencesBeginRegex(f),R=this.rules.other.headingBeginRegex(f),I=this.rules.other.htmlBeginRegex(f);for(;t;){const E=t.split(`
`,1)[0];let T;if(h=E,this.options.pedantic?(h=h.replace(this.rules.other.listReplaceNesting,"  "),T=h):T=h.replace(this.rules.other.tabCharGlobal,"    "),A.test(h)||R.test(h)||I.test(h)||k.test(h)||g.test(h))break;if(T.search(this.rules.other.nonSpaceChar)>=f||!h.trim())c+=`
`+T.slice(f);else{if(b||u.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||A.test(u)||R.test(u)||g.test(u))break;c+=`
`+h}!b&&!h.trim()&&(b=!0),o+=E+`
`,t=t.substring(E.length+1),u=T.slice(f)}}s.loose||(l?s.loose=!0:this.rules.other.doubleBlankLine.test(o)&&(l=!0));let x=null,v;this.options.gfm&&(x=this.rules.other.listIsTask.exec(c),x&&(v=x[0]!=="[ ] ",c=c.replace(this.rules.other.listReplaceTask,""))),s.items.push({type:"list_item",raw:o,task:!!x,checked:v,loose:!1,text:c,tokens:[]}),s.raw+=o}const a=s.items.at(-1);if(a)a.raw=a.raw.trimEnd(),a.text=a.text.trimEnd();else return;s.raw=s.raw.trimEnd();for(let p=0;p<s.items.length;p++)if(this.lexer.state.top=!1,s.items[p].tokens=this.lexer.blockTokens(s.items[p].text,[]),!s.loose){const o=s.items[p].tokens.filter(u=>u.type==="space"),c=o.length>0&&o.some(u=>this.rules.other.anyLine.test(u.raw));s.loose=c}if(s.loose)for(let p=0;p<s.items.length;p++)s.items[p].loose=!0;return s}}html(t){const e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){const e=this.rules.block.def.exec(t);if(e){const n=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),r=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",s=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:n,raw:e[0],href:r,title:s}}}table(t){var l;const e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;const n=Pt(e[1]),r=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),s=(l=e[3])!=null&&l.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],i={type:"table",raw:e[0],header:[],align:[],rows:[]};if(n.length===r.length){for(const a of r)this.rules.other.tableAlignRight.test(a)?i.align.push("right"):this.rules.other.tableAlignCenter.test(a)?i.align.push("center"):this.rules.other.tableAlignLeft.test(a)?i.align.push("left"):i.align.push(null);for(let a=0;a<n.length;a++)i.header.push({text:n[a],tokens:this.lexer.inline(n[a]),header:!0,align:i.align[a]});for(const a of s)i.rows.push(Pt(a,i.header.length).map((p,o)=>({text:p,tokens:this.lexer.inline(p),header:!1,align:i.align[o]})));return i}}lheading(t){const e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){const e=this.rules.block.paragraph.exec(t);if(e){const n=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:n,tokens:this.lexer.inline(n)}}}text(t){const e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){const e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){const e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){const e=this.rules.inline.link.exec(t);if(e){const n=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;const i=re(n.slice(0,-1),"\\");if((n.length-i.length)%2===0)return}else{const i=En(e[2],"()");if(i===-2)return;if(i>-1){const a=(e[0].indexOf("!")===0?5:4)+e[1].length+i;e[2]=e[2].substring(0,i),e[0]=e[0].substring(0,a).trim(),e[3]=""}}let r=e[2],s="";if(this.options.pedantic){const i=this.rules.other.pedanticHrefTitle.exec(r);i&&(r=i[1],s=i[3])}else s=e[3]?e[3].slice(1,-1):"";return r=r.trim(),this.rules.other.startAngleBracket.test(r)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?r=r.slice(1):r=r.slice(1,-1)),Bt(e,{href:r&&r.replace(this.rules.inline.anyPunctuation,"$1"),title:s&&s.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let n;if((n=this.rules.inline.reflink.exec(t))||(n=this.rules.inline.nolink.exec(t))){const r=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),s=e[r.toLowerCase()];if(!s){const i=n[0].charAt(0);return{type:"text",raw:i,text:i}}return Bt(n,s,n[0],this.lexer,this.rules)}}emStrong(t,e,n=""){let r=this.rules.inline.emStrongLDelim.exec(t);if(!r||r[3]&&n.match(this.rules.other.unicodeAlphaNumeric))return;if(!(r[1]||r[2]||"")||!n||this.rules.inline.punctuation.exec(n)){const i=[...r[0]].length-1;let l,a,p=i,o=0;const c=r[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,e=e.slice(-1*t.length+i);(r=c.exec(e))!=null;){if(l=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!l)continue;if(a=[...l].length,r[3]||r[4]){p+=a;continue}else if((r[5]||r[6])&&i%3&&!((i+a)%3)){o+=a;continue}if(p-=a,p>0)continue;a=Math.min(a,a+p+o);const u=[...r[0]][0].length,h=t.slice(0,i+r.index+u+a);if(Math.min(i,a)%2){const f=h.slice(1,-1);return{type:"em",raw:h,text:f,tokens:this.lexer.inlineTokens(f)}}const b=h.slice(2,-2);return{type:"strong",raw:h,text:b,tokens:this.lexer.inlineTokens(b)}}}}codespan(t){const e=this.rules.inline.code.exec(t);if(e){let n=e[2].replace(this.rules.other.newLineCharGlobal," ");const r=this.rules.other.nonSpaceChar.test(n),s=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return r&&s&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:e[0],text:n}}}br(t){const e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){const e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){const e=this.rules.inline.autolink.exec(t);if(e){let n,r;return e[2]==="@"?(n=e[1],r="mailto:"+n):(n=e[1],r=n),{type:"link",raw:e[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}url(t){var n;let e;if(e=this.rules.inline.url.exec(t)){let r,s;if(e[2]==="@")r=e[0],s="mailto:"+r;else{let i;do i=e[0],e[0]=((n=this.rules.inline._backpedal.exec(e[0]))==null?void 0:n[0])??"";while(i!==e[0]);r=e[0],e[1]==="www."?s="http://"+e[0]:s=e[0]}return{type:"link",raw:e[0],text:r,href:s,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){const e=this.rules.inline.text.exec(t);if(e){const n=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:n}}}},j=class Oe{constructor(e){S(this,"tokens");S(this,"options");S(this,"state");S(this,"tokenizer");S(this,"inlineQueue");this.tokens=[],this.tokens.links=Object.create(null),this.options=e||Z,this.options.tokenizer=this.options.tokenizer||new ge,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};const n={other:L,block:fe.normal,inline:ne.normal};this.options.pedantic?(n.block=fe.pedantic,n.inline=ne.pedantic):this.options.gfm&&(n.block=fe.gfm,this.options.breaks?n.inline=ne.breaks:n.inline=ne.gfm),this.tokenizer.rules=n}static get rules(){return{block:fe,inline:ne}}static lex(e,n){return new Oe(n).lex(e)}static lexInline(e,n){return new Oe(n).inlineTokens(e)}lex(e){e=e.replace(L.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let n=0;n<this.inlineQueue.length;n++){const r=this.inlineQueue[n];this.inlineTokens(r.src,r.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,n=[],r=!1){var s,i,l;for(this.options.pedantic&&(e=e.replace(L.tabCharGlobal,"    ").replace(L.spaceLine,""));e;){let a;if((i=(s=this.options.extensions)==null?void 0:s.block)!=null&&i.some(o=>(a=o.call({lexer:this},e,n))?(e=e.substring(a.raw.length),n.push(a),!0):!1))continue;if(a=this.tokenizer.space(e)){e=e.substring(a.raw.length);const o=n.at(-1);a.raw.length===1&&o!==void 0?o.raw+=`
`:n.push(a);continue}if(a=this.tokenizer.code(e)){e=e.substring(a.raw.length);const o=n.at(-1);(o==null?void 0:o.type)==="paragraph"||(o==null?void 0:o.type)==="text"?(o.raw+=`
`+a.raw,o.text+=`
`+a.text,this.inlineQueue.at(-1).src=o.text):n.push(a);continue}if(a=this.tokenizer.fences(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.heading(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.hr(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.blockquote(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.list(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.html(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.def(e)){e=e.substring(a.raw.length);const o=n.at(-1);(o==null?void 0:o.type)==="paragraph"||(o==null?void 0:o.type)==="text"?(o.raw+=`
`+a.raw,o.text+=`
`+a.raw,this.inlineQueue.at(-1).src=o.text):this.tokens.links[a.tag]||(this.tokens.links[a.tag]={href:a.href,title:a.title});continue}if(a=this.tokenizer.table(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.lheading(e)){e=e.substring(a.raw.length),n.push(a);continue}let p=e;if((l=this.options.extensions)!=null&&l.startBlock){let o=1/0;const c=e.slice(1);let u;this.options.extensions.startBlock.forEach(h=>{u=h.call({lexer:this},c),typeof u=="number"&&u>=0&&(o=Math.min(o,u))}),o<1/0&&o>=0&&(p=e.substring(0,o+1))}if(this.state.top&&(a=this.tokenizer.paragraph(p))){const o=n.at(-1);r&&(o==null?void 0:o.type)==="paragraph"?(o.raw+=`
`+a.raw,o.text+=`
`+a.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=o.text):n.push(a),r=p.length!==e.length,e=e.substring(a.raw.length);continue}if(a=this.tokenizer.text(e)){e=e.substring(a.raw.length);const o=n.at(-1);(o==null?void 0:o.type)==="text"?(o.raw+=`
`+a.raw,o.text+=`
`+a.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=o.text):n.push(a);continue}if(e){const o="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(o);break}else throw new Error(o)}}return this.state.top=!0,n}inline(e,n=[]){return this.inlineQueue.push({src:e,tokens:n}),n}inlineTokens(e,n=[]){var a,p,o;let r=e,s=null;if(this.tokens.links){const c=Object.keys(this.tokens.links);if(c.length>0)for(;(s=this.tokenizer.rules.inline.reflinkSearch.exec(r))!=null;)c.includes(s[0].slice(s[0].lastIndexOf("[")+1,-1))&&(r=r.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(s=this.tokenizer.rules.inline.anyPunctuation.exec(r))!=null;)r=r.slice(0,s.index)+"++"+r.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;(s=this.tokenizer.rules.inline.blockSkip.exec(r))!=null;)r=r.slice(0,s.index)+"["+"a".repeat(s[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);let i=!1,l="";for(;e;){i||(l=""),i=!1;let c;if((p=(a=this.options.extensions)==null?void 0:a.inline)!=null&&p.some(h=>(c=h.call({lexer:this},e,n))?(e=e.substring(c.raw.length),n.push(c),!0):!1))continue;if(c=this.tokenizer.escape(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.tag(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.link(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(c.raw.length);const h=n.at(-1);c.type==="text"&&(h==null?void 0:h.type)==="text"?(h.raw+=c.raw,h.text+=c.text):n.push(c);continue}if(c=this.tokenizer.emStrong(e,r,l)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.codespan(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.br(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.del(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.autolink(e)){e=e.substring(c.raw.length),n.push(c);continue}if(!this.state.inLink&&(c=this.tokenizer.url(e))){e=e.substring(c.raw.length),n.push(c);continue}let u=e;if((o=this.options.extensions)!=null&&o.startInline){let h=1/0;const b=e.slice(1);let f;this.options.extensions.startInline.forEach(x=>{f=x.call({lexer:this},b),typeof f=="number"&&f>=0&&(h=Math.min(h,f))}),h<1/0&&h>=0&&(u=e.substring(0,h+1))}if(c=this.tokenizer.inlineText(u)){e=e.substring(c.raw.length),c.raw.slice(-1)!=="_"&&(l=c.raw.slice(-1)),i=!0;const h=n.at(-1);(h==null?void 0:h.type)==="text"?(h.raw+=c.raw,h.text+=c.text):n.push(c);continue}if(e){const h="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(h);break}else throw new Error(h)}}return n}},ke=class{constructor(t){S(this,"options");S(this,"parser");this.options=t||Z}space(t){return""}code({text:t,lang:e,escaped:n}){var i;const r=(i=(e||"").match(L.notSpaceStart))==null?void 0:i[0],s=t.replace(L.endingNewline,"")+`
`;return r?'<pre><code class="language-'+H(r)+'">'+(n?s:H(s,!0))+`</code></pre>
`:"<pre><code>"+(n?s:H(s,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){const e=t.ordered,n=t.start;let r="";for(let l=0;l<t.items.length;l++){const a=t.items[l];r+=this.listitem(a)}const s=e?"ol":"ul",i=e&&n!==1?' start="'+n+'"':"";return"<"+s+i+`>
`+r+"</"+s+`>
`}listitem(t){var n;let e="";if(t.task){const r=this.checkbox({checked:!!t.checked});t.loose?((n=t.tokens[0])==null?void 0:n.type)==="paragraph"?(t.tokens[0].text=r+" "+t.tokens[0].text,t.tokens[0].tokens&&t.tokens[0].tokens.length>0&&t.tokens[0].tokens[0].type==="text"&&(t.tokens[0].tokens[0].text=r+" "+H(t.tokens[0].tokens[0].text),t.tokens[0].tokens[0].escaped=!0)):t.tokens.unshift({type:"text",raw:r+" ",text:r+" ",escaped:!0}):e+=r+" "}return e+=this.parser.parse(t.tokens,!!t.loose),`<li>${e}</li>
`}checkbox({checked:t}){return"<input "+(t?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph({tokens:t}){return`<p>${this.parser.parseInline(t)}</p>
`}table(t){let e="",n="";for(let s=0;s<t.header.length;s++)n+=this.tablecell(t.header[s]);e+=this.tablerow({text:n});let r="";for(let s=0;s<t.rows.length;s++){const i=t.rows[s];n="";for(let l=0;l<i.length;l++)n+=this.tablecell(i[l]);r+=this.tablerow({text:n})}return r&&(r=`<tbody>${r}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+r+`</table>
`}tablerow({text:t}){return`<tr>
${t}</tr>
`}tablecell(t){const e=this.parser.parseInline(t.tokens),n=t.header?"th":"td";return(t.align?`<${n} align="${t.align}">`:`<${n}>`)+e+`</${n}>
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${H(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:n}){const r=this.parser.parseInline(n),s=Et(t);if(s===null)return r;t=s;let i='<a href="'+t+'"';return e&&(i+=' title="'+H(e)+'"'),i+=">"+r+"</a>",i}image({href:t,title:e,text:n,tokens:r}){r&&(n=this.parser.parseInline(r,this.parser.textRenderer));const s=Et(t);if(s===null)return H(n);t=s;let i=`<img src="${t}" alt="${n}"`;return e&&(i+=` title="${H(e)}"`),i+=">",i}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:H(t.text)}},He=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}},W=class Ue{constructor(e){S(this,"options");S(this,"renderer");S(this,"textRenderer");this.options=e||Z,this.options.renderer=this.options.renderer||new ke,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new He}static parse(e,n){return new Ue(n).parse(e)}static parseInline(e,n){return new Ue(n).parseInline(e)}parse(e,n=!0){var s,i;let r="";for(let l=0;l<e.length;l++){const a=e[l];if((i=(s=this.options.extensions)==null?void 0:s.renderers)!=null&&i[a.type]){const o=a,c=this.options.extensions.renderers[o.type].call({parser:this},o);if(c!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(o.type)){r+=c||"";continue}}const p=a;switch(p.type){case"space":{r+=this.renderer.space(p);continue}case"hr":{r+=this.renderer.hr(p);continue}case"heading":{r+=this.renderer.heading(p);continue}case"code":{r+=this.renderer.code(p);continue}case"table":{r+=this.renderer.table(p);continue}case"blockquote":{r+=this.renderer.blockquote(p);continue}case"list":{r+=this.renderer.list(p);continue}case"html":{r+=this.renderer.html(p);continue}case"paragraph":{r+=this.renderer.paragraph(p);continue}case"text":{let o=p,c=this.renderer.text(o);for(;l+1<e.length&&e[l+1].type==="text";)o=e[++l],c+=`
`+this.renderer.text(o);n?r+=this.renderer.paragraph({type:"paragraph",raw:c,text:c,tokens:[{type:"text",raw:c,text:c,escaped:!0}]}):r+=c;continue}default:{const o='Token with "'+p.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return r}parseInline(e,n=this.renderer){var s,i;let r="";for(let l=0;l<e.length;l++){const a=e[l];if((i=(s=this.options.extensions)==null?void 0:s.renderers)!=null&&i[a.type]){const o=this.options.extensions.renderers[a.type].call({parser:this},a);if(o!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){r+=o||"";continue}}const p=a;switch(p.type){case"escape":{r+=n.text(p);break}case"html":{r+=n.html(p);break}case"link":{r+=n.link(p);break}case"image":{r+=n.image(p);break}case"strong":{r+=n.strong(p);break}case"em":{r+=n.em(p);break}case"codespan":{r+=n.codespan(p);break}case"br":{r+=n.br(p);break}case"del":{r+=n.del(p);break}case"text":{r+=n.text(p);break}default:{const o='Token with "'+p.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return r}},_e=(De=class{constructor(t){S(this,"options");S(this,"block");this.options=t||Z}preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}provideLexer(){return this.block?j.lex:j.lexInline}provideParser(){return this.block?W.parse:W.parseInline}},S(De,"passThroughHooks",new Set(["preprocess","postprocess","processAllTokens"])),De),Bn=class{constructor(...t){S(this,"defaults",Ae());S(this,"options",this.setOptions);S(this,"parse",this.parseMarkdown(!0));S(this,"parseInline",this.parseMarkdown(!1));S(this,"Parser",W);S(this,"Renderer",ke);S(this,"TextRenderer",He);S(this,"Lexer",j);S(this,"Tokenizer",ge);S(this,"Hooks",_e);this.use(...t)}walkTokens(t,e){var r,s;let n=[];for(const i of t)switch(n=n.concat(e.call(this,i)),i.type){case"table":{const l=i;for(const a of l.header)n=n.concat(this.walkTokens(a.tokens,e));for(const a of l.rows)for(const p of a)n=n.concat(this.walkTokens(p.tokens,e));break}case"list":{const l=i;n=n.concat(this.walkTokens(l.items,e));break}default:{const l=i;(s=(r=this.defaults.extensions)==null?void 0:r.childTokens)!=null&&s[l.type]?this.defaults.extensions.childTokens[l.type].forEach(a=>{const p=l[a].flat(1/0);n=n.concat(this.walkTokens(p,e))}):l.tokens&&(n=n.concat(this.walkTokens(l.tokens,e)))}}return n}use(...t){const e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(n=>{const r={...n};if(r.async=this.defaults.async||r.async||!1,n.extensions&&(n.extensions.forEach(s=>{if(!s.name)throw new Error("extension name required");if("renderer"in s){const i=e.renderers[s.name];i?e.renderers[s.name]=function(...l){let a=s.renderer.apply(this,l);return a===!1&&(a=i.apply(this,l)),a}:e.renderers[s.name]=s.renderer}if("tokenizer"in s){if(!s.level||s.level!=="block"&&s.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");const i=e[s.level];i?i.unshift(s.tokenizer):e[s.level]=[s.tokenizer],s.start&&(s.level==="block"?e.startBlock?e.startBlock.push(s.start):e.startBlock=[s.start]:s.level==="inline"&&(e.startInline?e.startInline.push(s.start):e.startInline=[s.start]))}"childTokens"in s&&s.childTokens&&(e.childTokens[s.name]=s.childTokens)}),r.extensions=e),n.renderer){const s=this.defaults.renderer||new ke(this.defaults);for(const i in n.renderer){if(!(i in s))throw new Error(`renderer '${i}' does not exist`);if(["options","parser"].includes(i))continue;const l=i,a=n.renderer[l],p=s[l];s[l]=(...o)=>{let c=a.apply(s,o);return c===!1&&(c=p.apply(s,o)),c||""}}r.renderer=s}if(n.tokenizer){const s=this.defaults.tokenizer||new ge(this.defaults);for(const i in n.tokenizer){if(!(i in s))throw new Error(`tokenizer '${i}' does not exist`);if(["options","rules","lexer"].includes(i))continue;const l=i,a=n.tokenizer[l],p=s[l];s[l]=(...o)=>{let c=a.apply(s,o);return c===!1&&(c=p.apply(s,o)),c}}r.tokenizer=s}if(n.hooks){const s=this.defaults.hooks||new _e;for(const i in n.hooks){if(!(i in s))throw new Error(`hook '${i}' does not exist`);if(["options","block"].includes(i))continue;const l=i,a=n.hooks[l],p=s[l];_e.passThroughHooks.has(i)?s[l]=o=>{if(this.defaults.async)return Promise.resolve(a.call(s,o)).then(u=>p.call(s,u));const c=a.call(s,o);return p.call(s,c)}:s[l]=(...o)=>{let c=a.apply(s,o);return c===!1&&(c=p.apply(s,o)),c}}r.hooks=s}if(n.walkTokens){const s=this.defaults.walkTokens,i=n.walkTokens;r.walkTokens=function(l){let a=[];return a.push(i.call(this,l)),s&&(a=a.concat(s.call(this,l))),a}}this.defaults={...this.defaults,...r}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return j.lex(t,e??this.defaults)}parser(t,e){return W.parse(t,e??this.defaults)}parseMarkdown(t){return(n,r)=>{const s={...r},i={...this.defaults,...s},l=this.onError(!!i.silent,!!i.async);if(this.defaults.async===!0&&s.async===!1)return l(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof n>"u"||n===null)return l(new Error("marked(): input parameter is undefined or null"));if(typeof n!="string")return l(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(n)+", string expected"));i.hooks&&(i.hooks.options=i,i.hooks.block=t);const a=i.hooks?i.hooks.provideLexer():t?j.lex:j.lexInline,p=i.hooks?i.hooks.provideParser():t?W.parse:W.parseInline;if(i.async)return Promise.resolve(i.hooks?i.hooks.preprocess(n):n).then(o=>a(o,i)).then(o=>i.hooks?i.hooks.processAllTokens(o):o).then(o=>i.walkTokens?Promise.all(this.walkTokens(o,i.walkTokens)).then(()=>o):o).then(o=>p(o,i)).then(o=>i.hooks?i.hooks.postprocess(o):o).catch(l);try{i.hooks&&(n=i.hooks.preprocess(n));let o=a(n,i);i.hooks&&(o=i.hooks.processAllTokens(o)),i.walkTokens&&this.walkTokens(o,i.walkTokens);let c=p(o,i);return i.hooks&&(c=i.hooks.postprocess(c)),c}catch(o){return l(o)}}}onError(t,e){return n=>{if(n.message+=`
Please report this to https://github.com/markedjs/marked.`,t){const r="<p>An error occurred:</p><pre>"+H(n.message+"",!0)+"</pre>";return e?Promise.resolve(r):r}if(e)return Promise.reject(n);throw n}}},G=new Bn;function m(t,e){return G.parse(t,e)}m.options=m.setOptions=function(t){return G.setOptions(t),m.defaults=G.defaults,xt(m.defaults),m},m.getDefaults=Ae,m.defaults=Z,m.use=function(...t){return G.use(...t),m.defaults=G.defaults,xt(m.defaults),m},m.walkTokens=function(t,e){return G.walkTokens(t,e)},m.parseInline=G.parseInline,m.Parser=W,m.parser=W.parse,m.Renderer=ke,m.TextRenderer=He,m.Lexer=j,m.lexer=j.lex,m.Tokenizer=ge,m.Hooks=_e,m.parse=m,m.options,m.setOptions,m.use,m.walkTokens,m.parseInline,W.parse,j.lex;function Nn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function Nt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),d("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function Mn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m5 12 7-7 7 7"}),d("path",{d:"M12 19V5"})]})}function Fn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"m6 9 6 6 6-6"})})}function Mt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function Hn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),d("path",{d:"M5 3v4"}),d("path",{d:"M19 17v4"}),d("path",{d:"M3 5h4"}),d("path",{d:"M17 19h4"})]})}function qn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"15 3 21 3 21 9"}),d("polyline",{points:"9 21 3 21 3 15"}),d("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Dn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"4 14 10 14 10 20"}),d("polyline",{points:"20 10 14 10 14 4"}),d("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}m.setOptions({breaks:!0,gfm:!0});const Ft=new m.Renderer;Ft.link=({href:t,title:e,text:n})=>{const r=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${r}>${n}</a>`},m.use({renderer:Ft});function jn(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function Wn(t){if(!t)return"";let e=t;return e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\[\d+\]/g,""),e=e.replace(/\(Source:[^)]*\)/gi,""),m.parse(e,{async:!1})}function On({message:t}){const[e,n]=B(!1),r=t.role==="user",s=t.citations&&t.citations.length>0;return d("div",{className:`kcb-message ${t.role}`,children:[d("div",{className:"kcb-message-bubble",dangerouslySetInnerHTML:{__html:r?jn(t.content):Wn(t.content)}}),t.isStreaming&&d("span",{className:"kcb-cursor"}),!r&&s&&d("div",{className:"kcb-sources",children:[d("button",{className:`kcb-sources-trigger ${e?"open":""}`,onClick:()=>n(!e),children:[d(Mt,{}),t.citations.length," source",t.citations.length!==1?"s":"",d(Fn,{})]}),d("div",{className:`kcb-sources-list ${e?"open":""}`,children:t.citations.map((i,l)=>d("a",{href:i.url||"#",target:"_blank",rel:"noopener noreferrer",className:"kcb-source",children:[d(Mt,{}),d("span",{className:"kcb-source-title",children:i.title||i.url||`Source ${l+1}`})]},l))})]})]})}function Un(){return d("div",{className:"kcb-typing",children:[d("div",{className:"kcb-typing-dot"}),d("div",{className:"kcb-typing-dot"}),d("div",{className:"kcb-typing-dot"})]})}function Ht({options:t,initialOpen:e=!1,onOpenChange:n}){const{token:r,apiBase:s="",position:i="bottom-right"}=t,[l,a]=B(e),[p,o]=B(!1),[c,u]=B(""),h=ue(null),b=ue(null),{config:f}=Xt({token:r,apiBase:s}),{messages:x,isLoading:v,sendMessage:k}=Vt({token:r,apiBase:s});ce(()=>{h.current&&h.current.scrollIntoView({behavior:"smooth"})},[x,v]),ce(()=>{l&&b.current&&setTimeout(()=>{var y;return(y=b.current)==null?void 0:y.focus()},100)},[l]),ce(()=>{n==null||n(l)},[l,n]);const g=()=>{a(!l)},A=()=>{c.trim()&&!v&&(k(c),u(""),b.current&&(b.current.style.height="auto"),setTimeout(()=>{var y;(y=b.current)==null||y.focus()},50))},R=y=>{y.key==="Enter"&&!y.shiftKey&&(y.preventDefault(),A())},I=y=>{const K=y.target;u(K.value),K.style.height="auto",K.style.height=Math.min(K.scrollHeight,120)+"px"},E=i==="bottom-left",T=(f==null?void 0:f.agentName)||"Assistant",q=(f==null?void 0:f.welcomeMessage)||"How can I help?",N=(f==null?void 0:f.description)||"Ask me anything. I'm here to assist you.",O=f==null?void 0:f.logoUrl,z=x.length===0&&!v;return d("div",{className:`kcb-container ${E?"left":""}`,children:[d("div",{className:`kcb-window ${l?"open":""} ${p?"expanded":""}`,children:[d("div",{className:"kcb-header",children:[d("div",{className:"kcb-header-left",children:[O&&d("img",{src:O,alt:"",className:"kcb-header-logo"}),d("h2",{className:"kcb-header-title",children:T})]}),d("div",{className:"kcb-header-actions",children:[d("button",{className:"kcb-header-btn",onClick:()=>o(!p),"aria-label":p?"Shrink chat":"Expand chat",children:p?d(Dn,{}):d(qn,{})}),d("button",{className:"kcb-header-btn",onClick:g,"aria-label":"Close chat",children:d(Nt,{})})]})]}),d("div",{className:"kcb-messages",children:[z?d("div",{className:"kcb-empty",children:[d(Hn,{className:"kcb-empty-icon"}),d("h3",{className:"kcb-empty-title",children:N}),d("p",{className:"kcb-empty-text",children:q})]}):d(V,{children:[x.map(y=>d(On,{message:y},y.id)),v&&d(Un,{})]}),d("div",{ref:h})]}),d("div",{className:"kcb-input-area",children:d("div",{className:"kcb-input-container",children:[d("textarea",{ref:b,className:"kcb-input",placeholder:"Type a message...",value:c,onInput:I,onKeyDown:R,rows:1,disabled:v}),d("button",{className:"kcb-send",onClick:A,disabled:!c.trim()||v,"aria-label":"Send message",children:d(Mn,{})})]})}),d("div",{className:"kcb-footer",children:["Powered by ",d("a",{href:"https://kcb.ai",target:"_blank",rel:"noopener",children:"KCB"})]})]}),d("button",{className:`kcb-launcher ${l?"open":""}`,onClick:g,"aria-label":l?"Close chat":"Open chat",children:l?d(Nt,{}):d(Nn,{})})]})}const Zn=`
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans:wght@400;500;600&display=swap');

  :host {
    /* Color System - Cool Blue Palette */
    --kcb-bg-primary: #F8FAFC;
    --kcb-bg-secondary: #F1F5F9;
    --kcb-bg-tertiary: #E2E8F0;
    --kcb-bg-elevated: #FFFFFF;

    --kcb-text-primary: #0F172A;
    --kcb-text-secondary: #475569;
    --kcb-text-tertiary: #94A3B8;
    --kcb-text-inverse: #FFFFFF;

    /* Blue Accent */
    --kcb-accent: #3B82F6;
    --kcb-accent-hover: #2563EB;
    --kcb-accent-subtle: #EFF6FF;

    /* Borders & Shadows */
    --kcb-border: #E2E8F0;
    --kcb-border-subtle: #F1F5F9;
    --kcb-shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
    --kcb-shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
    --kcb-shadow-lg: 0 12px 40px rgba(15, 23, 42, 0.12);
    --kcb-shadow-xl: 0 20px 60px rgba(15, 23, 42, 0.16);

    /* Typography */
    --kcb-font-sans: 'Noto Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    --kcb-font-mono: 'IBM Plex Mono', 'SF Mono', Monaco, monospace;

    /* Spacing */
    --kcb-space-xs: 4px;
    --kcb-space-sm: 8px;
    --kcb-space-md: 16px;
    --kcb-space-lg: 24px;
    --kcb-space-xl: 32px;

    /* Radii */
    --kcb-radius-sm: 8px;
    --kcb-radius-md: 12px;
    --kcb-radius-lg: 20px;
    --kcb-radius-full: 9999px;

    /* Animation */
    --kcb-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --kcb-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
    --kcb-duration-fast: 150ms;
    --kcb-duration-normal: 250ms;
    --kcb-duration-slow: 400ms;

    all: initial;
    font-family: var(--kcb-font-sans);
    font-size: 15px;
    line-height: 1.5;
    color: var(--kcb-text-primary);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  /* Container */
  .kcb-container {
    position: fixed;
    bottom: var(--kcb-space-lg);
    right: var(--kcb-space-lg);
    z-index: 2147483647;
    font-family: var(--kcb-font-sans);
  }

  .kcb-container.left {
    right: auto;
    left: var(--kcb-space-lg);
  }

  /* Launcher Button */
  .kcb-launcher {
    width: 56px;
    height: 56px;
    border-radius: var(--kcb-radius-full);
    border: none;
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--kcb-shadow-lg);
    transition:
      transform var(--kcb-duration-normal) var(--kcb-ease-out),
      box-shadow var(--kcb-duration-normal) var(--kcb-ease-out),
      background var(--kcb-duration-fast);
    position: relative;
    overflow: hidden;
  }

  .kcb-launcher::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%);
    opacity: 0;
    transition: opacity var(--kcb-duration-fast);
  }

  .kcb-launcher:hover {
    transform: scale(1.05);
    box-shadow: var(--kcb-shadow-xl);
    background: var(--kcb-accent-hover);
  }

  .kcb-launcher:hover::before {
    opacity: 1;
  }

  .kcb-launcher:active {
    transform: scale(0.98);
  }

  .kcb-launcher svg {
    width: 24px;
    height: 24px;
    transition: transform var(--kcb-duration-normal) var(--kcb-ease-out);
  }

  .kcb-launcher.open {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.8);
  }

  .kcb-launcher.open svg {
    transform: rotate(90deg) scale(0.9);
  }

  /* Chat Window */
  .kcb-window {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 400px;
    height: min(600px, calc(100vh - 48px));
    background: var(--kcb-bg-primary);
    border-radius: var(--kcb-radius-lg);
    box-shadow: var(--kcb-shadow-xl);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    transform: translateY(16px) scale(0.96);
    transform-origin: bottom right;
    pointer-events: none;
    transition:
      opacity var(--kcb-duration-slow) var(--kcb-ease-out),
      transform var(--kcb-duration-slow) var(--kcb-ease-out);
  }

  .kcb-container.left .kcb-window {
    right: auto;
    left: 0;
    transform-origin: bottom left;
  }

  .kcb-window.open {
    opacity: 1;
    transform: translateY(0) scale(1);
    pointer-events: auto;
  }

  .kcb-window.expanded {
    width: 650px;
    height: min(900px, calc(100vh - 60px));
  }

  /* Header */
  .kcb-header {
    padding: var(--kcb-space-md) var(--kcb-space-lg);
    background: var(--kcb-bg-elevated);
    border-bottom: 1px solid var(--kcb-border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    z-index: 1;
  }

  .kcb-header-left {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-sm);
  }

  .kcb-header-logo {
    width: 32px;
    height: 32px;
    border-radius: var(--kcb-radius-sm);
    object-fit: cover;
  }

  .kcb-header-title {
    font-family: var(--kcb-font-sans);
    font-size: 17px;
    font-weight: 600;
    color: var(--kcb-text-primary);
    letter-spacing: -0.01em;
  }

  .kcb-header-actions {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-xs);
  }

  .kcb-header-btn {
    width: 32px;
    height: 32px;
    border-radius: var(--kcb-radius-sm);
    border: none;
    background: transparent;
    color: var(--kcb-text-tertiary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      background var(--kcb-duration-fast),
      color var(--kcb-duration-fast);
  }

  .kcb-header-btn:hover {
    background: var(--kcb-bg-secondary);
    color: var(--kcb-text-primary);
  }

  .kcb-header-btn svg {
    width: 18px;
    height: 18px;
  }

  /* Messages Area */
  .kcb-messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--kcb-space-lg);
    display: flex;
    flex-direction: column;
    gap: var(--kcb-space-md);
    position: relative;
    z-index: 1;
    scroll-behavior: smooth;
  }

  .kcb-messages::-webkit-scrollbar {
    width: 6px;
  }

  .kcb-messages::-webkit-scrollbar-track {
    background: transparent;
  }

  .kcb-messages::-webkit-scrollbar-thumb {
    background: var(--kcb-border);
    border-radius: var(--kcb-radius-full);
  }

  /* Empty State */
  .kcb-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--kcb-space-xl);
    color: var(--kcb-text-secondary);
  }

  .kcb-empty-icon {
    width: 48px;
    height: 48px;
    margin-bottom: var(--kcb-space-md);
    color: var(--kcb-accent);
    opacity: 0.6;
  }

  .kcb-empty-title {
    font-family: var(--kcb-font-sans);
    font-size: 17px;
    font-weight: 600;
    color: var(--kcb-text-primary);
    margin-bottom: var(--kcb-space-xs);
  }

  .kcb-empty-text {
    font-size: 14px;
    color: var(--kcb-text-tertiary);
    max-width: 260px;
  }

  /* Message Bubble */
  .kcb-message {
    max-width: 85%;
    animation: kcb-message-in var(--kcb-duration-slow) var(--kcb-ease-out) forwards;
    opacity: 0;
    transform: translateY(8px);
  }

  @keyframes kcb-message-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .kcb-message.user {
    align-self: flex-end;
  }

  .kcb-message.assistant {
    align-self: flex-start;
  }

  .kcb-message-bubble {
    padding: var(--kcb-space-sm) var(--kcb-space-md);
    border-radius: var(--kcb-radius-md);
    font-size: 15px;
    line-height: 1.55;
  }

  .kcb-message.user .kcb-message-bubble {
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
    border-bottom-right-radius: var(--kcb-space-xs);
  }

  .kcb-message.assistant .kcb-message-bubble {
    background: var(--kcb-bg-elevated);
    color: var(--kcb-text-primary);
    border: 1px solid var(--kcb-border);
    border-bottom-left-radius: var(--kcb-space-xs);
  }

  /* Message Content Formatting */
  .kcb-message-bubble p {
    margin: 0 0 var(--kcb-space-sm) 0;
  }

  .kcb-message-bubble p:last-child {
    margin-bottom: 0;
  }

  .kcb-message-bubble strong {
    font-weight: 600;
  }

  .kcb-message-bubble em {
    font-style: italic;
  }

  .kcb-message-bubble code {
    font-family: var(--kcb-font-mono);
    font-size: 13px;
    background: var(--kcb-bg-tertiary);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .kcb-message.user .kcb-message-bubble code {
    background: rgba(255,255,255,0.2);
  }

  .kcb-message-bubble pre {
    background: #1E293B;
    color: #E2E8F0;
    padding: var(--kcb-space-sm) var(--kcb-space-md);
    border-radius: var(--kcb-radius-sm);
    overflow-x: auto;
    margin: var(--kcb-space-sm) 0;
    font-family: var(--kcb-font-mono);
    font-size: 13px;
    line-height: 1.5;
  }

  .kcb-message-bubble pre code {
    background: none;
    padding: 0;
    border-radius: 0;
    color: inherit;
    font-family: inherit;
  }

  .kcb-message-bubble a {
    color: var(--kcb-accent);
    text-decoration: none;
    border-bottom: 1px solid currentColor;
    transition: opacity var(--kcb-duration-fast);
  }

  .kcb-message-bubble a:hover {
    opacity: 0.7;
  }

  /* Lists */
  .kcb-message-bubble ol,
  .kcb-message-bubble ul {
    margin: var(--kcb-space-sm) 0;
    padding-left: var(--kcb-space-lg);
  }

  .kcb-message-bubble ol {
    list-style-type: decimal;
  }

  .kcb-message-bubble ul {
    list-style-type: disc;
  }

  .kcb-message-bubble li {
    margin-bottom: var(--kcb-space-xs);
    line-height: 1.5;
  }

  .kcb-message-bubble li:last-child {
    margin-bottom: 0;
  }

  /* Headings */
  .kcb-message-bubble h1,
  .kcb-message-bubble h2,
  .kcb-message-bubble h3,
  .kcb-message-bubble h4,
  .kcb-message-bubble h5,
  .kcb-message-bubble h6 {
    font-family: var(--kcb-font-sans);
    font-weight: 600;
    line-height: 1.3;
    margin: var(--kcb-space-md) 0 var(--kcb-space-sm) 0;
    color: var(--kcb-text-primary);
  }

  .kcb-message-bubble h1:first-child,
  .kcb-message-bubble h2:first-child,
  .kcb-message-bubble h3:first-child {
    margin-top: 0;
  }

  .kcb-message-bubble h1 { font-size: 1.5em; }
  .kcb-message-bubble h2 { font-size: 1.3em; }
  .kcb-message-bubble h3 { font-size: 1.15em; }
  .kcb-message-bubble h4 { font-size: 1.05em; }
  .kcb-message-bubble h5 { font-size: 1em; }
  .kcb-message-bubble h6 { font-size: 0.95em; color: var(--kcb-text-secondary); }

  /* Blockquotes */
  .kcb-message-bubble blockquote {
    margin: var(--kcb-space-sm) 0;
    padding: var(--kcb-space-sm) var(--kcb-space-md);
    border-left: 3px solid var(--kcb-accent);
    background: var(--kcb-bg-secondary);
    border-radius: 0 var(--kcb-radius-sm) var(--kcb-radius-sm) 0;
    color: var(--kcb-text-secondary);
    font-style: italic;
  }

  .kcb-message-bubble blockquote p {
    margin: 0;
  }

  /* Horizontal Rule */
  .kcb-message-bubble hr {
    border: none;
    border-top: 1px solid var(--kcb-border);
    margin: var(--kcb-space-md) 0;
  }

  /* Tables */
  .kcb-message-bubble table {
    width: 100%;
    border-collapse: collapse;
    margin: var(--kcb-space-sm) 0;
    font-size: 13px;
  }

  .kcb-message-bubble th,
  .kcb-message-bubble td {
    padding: var(--kcb-space-xs) var(--kcb-space-sm);
    text-align: left;
    border: 1px solid var(--kcb-border);
  }

  .kcb-message-bubble th {
    background: var(--kcb-bg-secondary);
    font-weight: 600;
    color: var(--kcb-text-primary);
  }

  .kcb-message-bubble td {
    background: var(--kcb-bg-elevated);
  }

  .kcb-message-bubble tr:nth-child(even) td {
    background: var(--kcb-bg-primary);
  }

  /* Streaming Cursor */
  .kcb-cursor {
    display: inline-block;
    width: 2px;
    height: 1em;
    background: var(--kcb-accent);
    margin-left: 2px;
    animation: kcb-blink 1s ease-in-out infinite;
    vertical-align: text-bottom;
  }

  @keyframes kcb-blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  /* Sources */
  .kcb-sources {
    margin-top: var(--kcb-space-sm);
  }

  .kcb-sources-trigger {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-xs);
    padding: var(--kcb-space-xs) var(--kcb-space-sm);
    background: var(--kcb-accent-subtle);
    border: none;
    border-radius: var(--kcb-radius-sm);
    font-family: var(--kcb-font-sans);
    font-size: 12px;
    font-weight: 500;
    color: var(--kcb-accent);
    cursor: pointer;
    transition: background var(--kcb-duration-fast), color var(--kcb-duration-fast);
  }

  .kcb-sources-trigger:hover {
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
  }

  .kcb-sources-trigger svg {
    width: 12px;
    height: 12px;
    transition: transform var(--kcb-duration-fast);
  }

  .kcb-sources-trigger.open svg {
    transform: rotate(180deg);
  }

  .kcb-sources-list {
    display: none;
    margin-top: var(--kcb-space-sm);
    padding: var(--kcb-space-sm);
    background: var(--kcb-bg-secondary);
    border-radius: var(--kcb-radius-sm);
  }

  .kcb-sources-list.open {
    display: block;
    animation: kcb-fade-in var(--kcb-duration-fast) var(--kcb-ease-out);
  }

  @keyframes kcb-fade-in {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .kcb-source {
    display: flex;
    align-items: flex-start;
    gap: var(--kcb-space-sm);
    padding: var(--kcb-space-xs) 0;
    text-decoration: none;
    color: var(--kcb-text-secondary);
    font-size: 13px;
    transition: color var(--kcb-duration-fast);
  }

  .kcb-source:hover {
    color: var(--kcb-accent);
  }

  .kcb-source svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .kcb-source-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Typing Indicator - Centered in message area */
  .kcb-typing {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: var(--kcb-space-lg);
    flex: 1;
    min-height: 100px;
  }

  .kcb-typing-dot {
    width: 8px;
    height: 8px;
    background: var(--kcb-accent);
    border-radius: 50%;
    animation: kcb-typing 1.4s ease-in-out infinite;
  }

  .kcb-typing-dot:nth-child(1) { animation-delay: 0s; }
  .kcb-typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .kcb-typing-dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes kcb-typing {
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
  .kcb-input-area {
    padding: var(--kcb-space-md) var(--kcb-space-lg);
    background: var(--kcb-bg-elevated);
    border-top: 1px solid var(--kcb-border-subtle);
    position: relative;
    z-index: 1;
  }

  .kcb-input-container {
    display: flex;
    align-items: center;
    gap: var(--kcb-space-sm);
    background: var(--kcb-bg-secondary);
    border-radius: var(--kcb-radius-md);
    padding: var(--kcb-space-sm);
    transition: box-shadow var(--kcb-duration-fast);
  }

  .kcb-input-container:focus-within {
    box-shadow: 0 0 0 2px var(--kcb-accent);
  }

  .kcb-input {
    flex: 1;
    border: none;
    background: transparent;
    font-family: var(--kcb-font-sans);
    font-size: 15px;
    line-height: 1.4;
    color: var(--kcb-text-primary);
    resize: none;
    outline: none;
    min-height: 36px;
    max-height: 120px;
    padding: 8px 4px;
    display: flex;
    align-items: center;
  }

  .kcb-input::placeholder {
    color: var(--kcb-text-tertiary);
  }

  .kcb-send {
    width: 36px;
    height: 36px;
    border-radius: var(--kcb-radius-sm);
    border: none;
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background var(--kcb-duration-fast),
      transform var(--kcb-duration-fast);
  }

  .kcb-send:hover:not(:disabled) {
    background: var(--kcb-accent-hover);
  }

  .kcb-send:active:not(:disabled) {
    transform: scale(0.95);
  }

  .kcb-send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .kcb-send svg {
    width: 18px;
    height: 18px;
  }

  /* Footer */
  .kcb-footer {
    padding: var(--kcb-space-sm) var(--kcb-space-lg);
    text-align: center;
    font-size: 11px;
    color: var(--kcb-text-tertiary);
    background: var(--kcb-bg-elevated);
    border-top: 1px solid var(--kcb-border-subtle);
  }

  .kcb-footer a {
    color: inherit;
    text-decoration: none;
    opacity: 0.8;
    transition: opacity var(--kcb-duration-fast);
  }

  .kcb-footer a:hover {
    opacity: 1;
  }

  /* Mobile Responsive */
  @media (max-width: 480px) {
    .kcb-container {
      bottom: var(--kcb-space-md);
      right: var(--kcb-space-md);
    }

    .kcb-container.left {
      left: var(--kcb-space-md);
    }

    .kcb-window {
      width: calc(100vw - var(--kcb-space-xl));
      height: calc(100vh - 32px);
      max-height: none;
      bottom: 0;
    }

    .kcb-window.expanded {
      width: calc(100vw - var(--kcb-space-xl));
      height: calc(100vh - 32px);
    }

    .kcb-launcher {
      width: 52px;
      height: 52px;
    }
  }

  /* Tablet breakpoint for expanded */
  @media (min-width: 481px) and (max-width: 768px) {
    .kcb-window.expanded {
      width: min(580px, calc(100vw - 60px));
      height: min(800px, calc(100vh - 60px));
    }
  }
`;class Gn{constructor(){this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.processQueue()}processQueue(){var n;const e=((n=window.kcb)==null?void 0:n.q)||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,n){switch(e){case"init":this.init(n);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[KCB Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[KCB Widget] Already initialized");return}if(!(e!=null&&e.token)){console.error("[KCB Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase()},this.container=document.createElement("div"),this.container.id="kcb-widget-root",document.body.appendChild(this.container),this.shadowRoot=this.container.attachShadow({mode:"open"});const n=document.createElement("style");n.textContent=Zn,this.shadowRoot.appendChild(n);const r=document.createElement("div");this.shadowRoot.appendChild(r),ot(d(Ht,{options:this.options,initialOpen:this.openState,onOpenChange:s=>{var i;this.openState=s,(i=this.openCallback)==null||i.call(this,s)}}),r),this.isInitialized=!0,console.log("[KCB Widget] Initialized")}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const n of e){const r=n.getAttribute("src");if(r)try{return new URL(r,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){if(!this.shadowRoot||!this.options)return;const e=this.shadowRoot.querySelector("div:last-child");e&&ot(d(Ht,{options:this.options,initialOpen:this.openState,onOpenChange:n=>{var r;this.openState=n,(r=this.openCallback)==null||r.call(this,n)}}),e)}destroy(){this.container&&this.container.remove(),this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[KCB Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const qe=new Gn;function qt(t,e){qe.handleCommand(t,e)}return window.kcb=qt,window.KCBWidget=qe,F.KCBWidget=qe,F.kcb=qt,Object.defineProperty(F,Symbol.toStringTag,{value:"Module"}),F}({});
