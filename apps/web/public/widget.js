var GroundedWidget=(function(he){"use strict";var fe,y,tt,Z,rt,nt,ot,at,Re,Te,Ae,re={},st=[],nr=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,me=Array.isArray;function q(t,e){for(var r in e)t[r]=e[r];return t}function Ie(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function or(t,e,r){var o,n,a,s={};for(a in e)a=="key"?o=e[a]:a=="ref"?n=e[a]:s[a]=e[a];if(arguments.length>2&&(s.children=arguments.length>3?fe.call(arguments,2):r),typeof t=="function"&&t.defaultProps!=null)for(a in t.defaultProps)s[a]===void 0&&(s[a]=t.defaultProps[a]);return be(t,s,o,n,null)}function be(t,e,r,o,n){var a={type:t,props:e,key:r,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++tt,__i:-1,__u:0};return n==null&&y.vnode!=null&&y.vnode(a),a}function G(t){return t.children}function xe(t,e){this.props=t,this.context=e}function K(t,e){if(e==null)return t.__?K(t.__,t.__i+1):null;for(var r;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null)return r.__e;return typeof t.type=="function"?K(t):null}function it(t){var e,r;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null){t.__e=t.__c.base=r.__e;break}return it(t)}}function dt(t){(!t.__d&&(t.__d=!0)&&Z.push(t)&&!ke.__r++||rt!=y.debounceRendering)&&((rt=y.debounceRendering)||nt)(ke)}function ke(){for(var t,e,r,o,n,a,s,l=1;Z.length;)Z.length>l&&Z.sort(ot),t=Z.shift(),l=Z.length,t.__d&&(r=void 0,o=void 0,n=(o=(e=t).__v).__e,a=[],s=[],e.__P&&((r=q({},o)).__v=o.__v+1,y.vnode&&y.vnode(r),Le(e.__P,r,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,a,n??K(o),!!(32&o.__u),s),r.__v=o.__v,r.__.__k[r.__i]=r,pt(a,r,s),o.__e=o.__=null,r.__e!=n&&it(r)));ke.__r=0}function lt(t,e,r,o,n,a,s,l,i,u,g){var c,p,h,f,b,v,x,m=o&&o.__k||st,w=e.length;for(i=ar(r,e,m,i,w),c=0;c<w;c++)(h=r.__k[c])!=null&&(p=h.__i==-1?re:m[h.__i]||re,h.__i=c,v=Le(t,h,p,n,a,s,l,i,u,g),f=h.__e,h.ref&&p.ref!=h.ref&&(p.ref&&Be(p.ref,null,h),g.push(h.ref,h.__c||f,h)),b==null&&f!=null&&(b=f),(x=!!(4&h.__u))||p.__k===h.__k?i=ut(h,i,t,x):typeof h.type=="function"&&v!==void 0?i=v:f&&(i=f.nextSibling),h.__u&=-7);return r.__e=b,i}function ar(t,e,r,o,n){var a,s,l,i,u,g=r.length,c=g,p=0;for(t.__k=new Array(n),a=0;a<n;a++)(s=e[a])!=null&&typeof s!="boolean"&&typeof s!="function"?(typeof s=="string"||typeof s=="number"||typeof s=="bigint"||s.constructor==String?s=t.__k[a]=be(null,s,null,null,null):me(s)?s=t.__k[a]=be(G,{children:s},null,null,null):s.constructor===void 0&&s.__b>0?s=t.__k[a]=be(s.type,s.props,s.key,s.ref?s.ref:null,s.__v):t.__k[a]=s,i=a+p,s.__=t,s.__b=t.__b+1,l=null,(u=s.__i=sr(s,r,i,c))!=-1&&(c--,(l=r[u])&&(l.__u|=2)),l==null||l.__v==null?(u==-1&&(n>g?p--:n<g&&p++),typeof s.type!="function"&&(s.__u|=4)):u!=i&&(u==i-1?p--:u==i+1?p++:(u>i?p--:p++,s.__u|=4))):t.__k[a]=null;if(c)for(a=0;a<g;a++)(l=r[a])!=null&&(2&l.__u)==0&&(l.__e==o&&(o=K(l)),ft(l,l));return o}function ut(t,e,r,o){var n,a;if(typeof t.type=="function"){for(n=t.__k,a=0;n&&a<n.length;a++)n[a]&&(n[a].__=t,e=ut(n[a],e,r,o));return e}t.__e!=e&&(o&&(e&&t.type&&!e.parentNode&&(e=K(t)),r.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function sr(t,e,r,o){var n,a,s,l=t.key,i=t.type,u=e[r],g=u!=null&&(2&u.__u)==0;if(u===null&&l==null||g&&l==u.key&&i==u.type)return r;if(o>(g?1:0)){for(n=r-1,a=r+1;n>=0||a<e.length;)if((u=e[s=n>=0?n--:a++])!=null&&(2&u.__u)==0&&l==u.key&&i==u.type)return s}return-1}function ct(t,e,r){e[0]=="-"?t.setProperty(e,r??""):t[e]=r==null?"":typeof r!="number"||nr.test(e)?r:r+"px"}function _e(t,e,r,o,n){var a,s;e:if(e=="style")if(typeof r=="string")t.style.cssText=r;else{if(typeof o=="string"&&(t.style.cssText=o=""),o)for(e in o)r&&e in r||ct(t.style,e,"");if(r)for(e in r)o&&r[e]==o[e]||ct(t.style,e,r[e])}else if(e[0]=="o"&&e[1]=="n")a=e!=(e=e.replace(at,"$1")),s=e.toLowerCase(),e=s in t||e=="onFocusOut"||e=="onFocusIn"?s.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+a]=r,r?o?r.u=o.u:(r.u=Re,t.addEventListener(e,a?Ae:Te,a)):t.removeEventListener(e,a?Ae:Te,a);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&r==1?"":r))}}function gt(t){return function(e){if(this.l){var r=this.l[e.type+t];if(e.t==null)e.t=Re++;else if(e.t<r.u)return;return r(y.event?y.event(e):e)}}}function Le(t,e,r,o,n,a,s,l,i,u){var g,c,p,h,f,b,v,x,m,w,R,T,B,O,D,I,L,C=e.type;if(e.constructor!==void 0)return null;128&r.__u&&(i=!!(32&r.__u),a=[l=e.__e=r.__e]),(g=y.__b)&&g(e);e:if(typeof C=="function")try{if(x=e.props,m="prototype"in C&&C.prototype.render,w=(g=C.contextType)&&o[g.__c],R=g?w?w.props.value:g.__:o,r.__c?v=(c=e.__c=r.__c).__=c.__E:(m?e.__c=c=new C(x,R):(e.__c=c=new xe(x,R),c.constructor=C,c.render=dr),w&&w.sub(c),c.state||(c.state={}),c.__n=o,p=c.__d=!0,c.__h=[],c._sb=[]),m&&c.__s==null&&(c.__s=c.state),m&&C.getDerivedStateFromProps!=null&&(c.__s==c.state&&(c.__s=q({},c.__s)),q(c.__s,C.getDerivedStateFromProps(x,c.__s))),h=c.props,f=c.state,c.__v=e,p)m&&C.getDerivedStateFromProps==null&&c.componentWillMount!=null&&c.componentWillMount(),m&&c.componentDidMount!=null&&c.__h.push(c.componentDidMount);else{if(m&&C.getDerivedStateFromProps==null&&x!==h&&c.componentWillReceiveProps!=null&&c.componentWillReceiveProps(x,R),e.__v==r.__v||!c.__e&&c.shouldComponentUpdate!=null&&c.shouldComponentUpdate(x,c.__s,R)===!1){for(e.__v!=r.__v&&(c.props=x,c.state=c.__s,c.__d=!1),e.__e=r.__e,e.__k=r.__k,e.__k.some(function(N){N&&(N.__=e)}),T=0;T<c._sb.length;T++)c.__h.push(c._sb[T]);c._sb=[],c.__h.length&&s.push(c);break e}c.componentWillUpdate!=null&&c.componentWillUpdate(x,c.__s,R),m&&c.componentDidUpdate!=null&&c.__h.push(function(){c.componentDidUpdate(h,f,b)})}if(c.context=R,c.props=x,c.__P=t,c.__e=!1,B=y.__r,O=0,m){for(c.state=c.__s,c.__d=!1,B&&B(e),g=c.render(c.props,c.state,c.context),D=0;D<c._sb.length;D++)c.__h.push(c._sb[D]);c._sb=[]}else do c.__d=!1,B&&B(e),g=c.render(c.props,c.state,c.context),c.state=c.__s;while(c.__d&&++O<25);c.state=c.__s,c.getChildContext!=null&&(o=q(q({},o),c.getChildContext())),m&&!p&&c.getSnapshotBeforeUpdate!=null&&(b=c.getSnapshotBeforeUpdate(h,f)),I=g,g!=null&&g.type===G&&g.key==null&&(I=ht(g.props.children)),l=lt(t,me(I)?I:[I],e,r,o,n,a,s,l,i,u),c.base=e.__e,e.__u&=-161,c.__h.length&&s.push(c),v&&(c.__E=c.__=null)}catch(N){if(e.__v=null,i||a!=null)if(N.then){for(e.__u|=i?160:128;l&&l.nodeType==8&&l.nextSibling;)l=l.nextSibling;a[a.indexOf(l)]=null,e.__e=l}else{for(L=a.length;L--;)Ie(a[L]);Me(e)}else e.__e=r.__e,e.__k=r.__k,N.then||Me(e);y.__e(N,e,r)}else a==null&&e.__v==r.__v?(e.__k=r.__k,e.__e=r.__e):l=e.__e=ir(r.__e,e,r,o,n,a,s,i,u);return(g=y.diffed)&&g(e),128&e.__u?void 0:l}function Me(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Me)}function pt(t,e,r){for(var o=0;o<r.length;o++)Be(r[o],r[++o],r[++o]);y.__c&&y.__c(e,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(a){a.call(n)})}catch(a){y.__e(a,n.__v)}})}function ht(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:me(t)?t.map(ht):q({},t)}function ir(t,e,r,o,n,a,s,l,i){var u,g,c,p,h,f,b,v=r.props||re,x=e.props,m=e.type;if(m=="svg"?n="http://www.w3.org/2000/svg":m=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),a!=null){for(u=0;u<a.length;u++)if((h=a[u])&&"setAttribute"in h==!!m&&(m?h.localName==m:h.nodeType==3)){t=h,a[u]=null;break}}if(t==null){if(m==null)return document.createTextNode(x);t=document.createElementNS(n,m,x.is&&x),l&&(y.__m&&y.__m(e,a),l=!1),a=null}if(m==null)v===x||l&&t.data==x||(t.data=x);else{if(a=a&&fe.call(t.childNodes),!l&&a!=null)for(v={},u=0;u<t.attributes.length;u++)v[(h=t.attributes[u]).name]=h.value;for(u in v)if(h=v[u],u!="children"){if(u=="dangerouslySetInnerHTML")c=h;else if(!(u in x)){if(u=="value"&&"defaultValue"in x||u=="checked"&&"defaultChecked"in x)continue;_e(t,u,null,h,n)}}for(u in x)h=x[u],u=="children"?p=h:u=="dangerouslySetInnerHTML"?g=h:u=="value"?f=h:u=="checked"?b=h:l&&typeof h!="function"||v[u]===h||_e(t,u,h,v[u],n);if(g)l||c&&(g.__html==c.__html||g.__html==t.innerHTML)||(t.innerHTML=g.__html),e.__k=[];else if(c&&(t.innerHTML=""),lt(e.type=="template"?t.content:t,me(p)?p:[p],e,r,o,m=="foreignObject"?"http://www.w3.org/1999/xhtml":n,a,s,a?a[0]:r.__k&&K(r,0),l,i),a!=null)for(u=a.length;u--;)Ie(a[u]);l||(u="value",m=="progress"&&f==null?t.removeAttribute("value"):f!=null&&(f!==t[u]||m=="progress"&&!f||m=="option"&&f!=v[u])&&_e(t,u,f,v[u],n),u="checked",b!=null&&b!=t[u]&&_e(t,u,b,v[u],n))}return t}function Be(t,e,r){try{if(typeof t=="function"){var o=typeof t.__u=="function";o&&t.__u(),o&&e==null||(t.__u=t(e))}else t.current=e}catch(n){y.__e(n,r)}}function ft(t,e,r){var o,n;if(y.unmount&&y.unmount(t),(o=t.ref)&&(o.current&&o.current!=t.__e||Be(o,null,e)),(o=t.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(a){y.__e(a,e)}o.base=o.__P=null}if(o=t.__k)for(n=0;n<o.length;n++)o[n]&&ft(o[n],e,r||typeof t.type!="function");r||Ie(t.__e),t.__c=t.__=t.__e=void 0}function dr(t,e,r){return this.constructor(t,r)}function mt(t,e,r){var o,n,a,s;e==document&&(e=document.documentElement),y.__&&y.__(t,e),n=(o=!1)?null:e.__k,a=[],s=[],Le(e,t=e.__k=or(G,null,[t]),n||re,re,e.namespaceURI,n?null:e.firstChild?fe.call(e.childNodes):null,a,n?n.__e:e.firstChild,o,s),pt(a,t,s)}fe=st.slice,y={__e:function(t,e,r,o){for(var n,a,s;e=e.__;)if((n=e.__c)&&!n.__)try{if((a=n.constructor)&&a.getDerivedStateFromError!=null&&(n.setState(a.getDerivedStateFromError(t)),s=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(t,o||{}),s=n.__d),s)return n.__E=n}catch(l){t=l}throw t}},tt=0,xe.prototype.setState=function(t,e){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=q({},this.state),typeof t=="function"&&(t=t(q({},r),this.props)),t&&q(r,t),t!=null&&this.__v&&(e&&this._sb.push(e),dt(this))},xe.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),dt(this))},xe.prototype.render=G,Z=[],nt=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,ot=function(t,e){return t.__v.__b-e.__v.__b},ke.__r=0,at=/(PointerCapture)$|Capture$/i,Re=0,Te=gt(!1),Ae=gt(!0);var lr=0;function d(t,e,r,o,n,a){e||(e={});var s,l,i=e;if("ref"in i)for(l in i={},e)l=="ref"?s=e[l]:i[l]=e[l];var u={type:t,props:i,key:r,ref:s,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--lr,__i:-1,__u:0,__source:n,__self:a};if(typeof t=="function"&&(s=t.defaultProps))for(l in s)i[l]===void 0&&(i[l]=s[l]);return y.vnode&&y.vnode(u),u}var ne,$,Ne,bt,oe=0,xt=[],z=y,kt=z.__b,_t=z.__r,vt=z.diffed,yt=z.__c,wt=z.unmount,St=z.__;function Ee(t,e){z.__h&&z.__h($,t,oe||e),oe=0;var r=$.__H||($.__H={__:[],__h:[]});return t>=r.__.length&&r.__.push({}),r.__[t]}function M(t){return oe=1,ur(Rt,t)}function ur(t,e,r){var o=Ee(ne++,2);if(o.t=t,!o.__c&&(o.__=[Rt(void 0,e),function(l){var i=o.__N?o.__N[0]:o.__[0],u=o.t(i,l);i!==u&&(o.__N=[u,o.__[1]],o.__c.setState({}))}],o.__c=$,!$.__f)){var n=function(l,i,u){if(!o.__c.__H)return!0;var g=o.__c.__H.__.filter(function(p){return!!p.__c});if(g.every(function(p){return!p.__N}))return!a||a.call(this,l,i,u);var c=o.__c.props!==l;return g.forEach(function(p){if(p.__N){var h=p.__[0];p.__=p.__N,p.__N=void 0,h!==p.__[0]&&(c=!0)}}),a&&a.call(this,l,i,u)||c};$.__f=!0;var a=$.shouldComponentUpdate,s=$.componentWillUpdate;$.componentWillUpdate=function(l,i,u){if(this.__e){var g=a;a=void 0,n(l,i,u),a=g}s&&s.call(this,l,i,u)},$.shouldComponentUpdate=n}return o.__N||o.__}function ae(t,e){var r=Ee(ne++,3);!z.__s&&Ct(r.__H,e)&&(r.__=t,r.u=e,$.__H.__h.push(r))}function Q(t){return oe=5,$t(function(){return{current:t}},[])}function $t(t,e){var r=Ee(ne++,7);return Ct(r.__H,e)&&(r.__=t(),r.__H=e,r.__h=t),r.__}function Pe(t,e){return oe=8,$t(function(){return t},e)}function cr(){for(var t;t=xt.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(ve),t.__H.__h.forEach(Fe),t.__H.__h=[]}catch(e){t.__H.__h=[],z.__e(e,t.__v)}}z.__b=function(t){$=null,kt&&kt(t)},z.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),St&&St(t,e)},z.__r=function(t){_t&&_t(t),ne=0;var e=($=t.__c).__H;e&&(Ne===$?(e.__h=[],$.__h=[],e.__.forEach(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(e.__h.forEach(ve),e.__h.forEach(Fe),e.__h=[],ne=0)),Ne=$},z.diffed=function(t){vt&&vt(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(xt.push(e)!==1&&bt===z.requestAnimationFrame||((bt=z.requestAnimationFrame)||gr)(cr)),e.__H.__.forEach(function(r){r.u&&(r.__H=r.u),r.u=void 0})),Ne=$=null},z.__c=function(t,e){e.some(function(r){try{r.__h.forEach(ve),r.__h=r.__h.filter(function(o){return!o.__||Fe(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],z.__e(o,r.__v)}}),yt&&yt(t,e)},z.unmount=function(t){wt&&wt(t);var e,r=t.__c;r&&r.__H&&(r.__H.__.forEach(function(o){try{ve(o)}catch(n){e=n}}),r.__H=void 0,e&&z.__e(e,r.__v))};var zt=typeof requestAnimationFrame=="function";function gr(t){var e,r=function(){clearTimeout(o),zt&&cancelAnimationFrame(e),setTimeout(t)},o=setTimeout(r,35);zt&&(e=requestAnimationFrame(r))}function ve(t){var e=$,r=t.__c;typeof r=="function"&&(t.__c=void 0,r()),$=e}function Fe(t){var e=$;t.__c=t.__(),$=e}function Ct(t,e){return!t||t.length!==e.length||e.some(function(r,o){return r!==t[o]})}function Rt(t,e){return typeof e=="function"?e(t):e}function pr({token:t,apiBase:e,endpointType:r="widget"}){const[o,n]=M([]),[a,s]=M(!1),[l,i]=M(!1),[u,g]=M(null),[c,p]=M({status:"idle"}),[h,f]=M([]),b=Q(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),v=Q(null),x=Q(null),m=Q(new Map),w=()=>Math.random().toString(36).slice(2,11),R=Pe(async O=>{if(!O.trim()||a||l)return;const D={id:w(),role:"user",content:O.trim(),timestamp:Date.now()},I=w();n(L=>[...L,D]),s(!0),i(!0),g(null),p({status:"searching",message:"Searching knowledge base..."}),f([]),x.current=null,m.current.clear(),v.current=new AbortController;try{const L={message:O.trim()};b.current&&(L.conversationId=b.current);const C=r==="chat-endpoint"?`${e}/api/v1/c/${t}/chat/stream`:`${e}/api/v1/widget/${t}/chat/stream`,N=await fetch(C,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(L),signal:v.current.signal});if(!N.ok){const U=await N.json().catch(()=>({}));throw new Error(U.message||`Request failed: ${N.status}`)}n(U=>[...U,{id:I,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),s(!1);const H=N.body?.getReader();if(!H)throw new Error("No response body");const Xe=new TextDecoder;let ce="",J="";for(;;){const{done:U,value:Ke}=await H.read();if(U)break;ce+=Xe.decode(Ke,{stream:!0});const ge=ce.split(`
`);ce=ge.pop()||"";for(const pe of ge)if(pe.startsWith("data: "))try{const S=JSON.parse(pe.slice(6));if(S.type==="status"){const P=S.status==="searching"?"searching":S.status==="generating"?"generating":"searching";p({status:P,message:S.message,sourcesCount:S.sourcesCount})}else if(S.type==="sources"&&S.sources)x.current=S.sources.map(P=>({index:P.index,title:P.title,url:P.url,snippet:P.snippet}));else if(S.type==="reasoning"&&S.step)m.current.set(S.step.id,S.step),f(Array.from(m.current.values()));else if(S.type==="text"&&S.content)J||p({status:"streaming"}),J+=S.content,n(P=>P.map(X=>X.id===I?{...X,content:J}:X));else if(S.type==="done"){if(S.conversationId){b.current=S.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,S.conversationId)}catch{}}const P=x.current?[...x.current]:[];x.current=null,m.current.clear(),n(X=>X.map(ee=>ee.id===I?{...ee,content:J,isStreaming:!1,citations:P}:ee)),p({status:"idle"})}else if(S.type==="error")throw new Error(S.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",pe)}}}catch(L){if(m.current.clear(),f([]),L.name==="AbortError"){p({status:"idle"});return}p({status:"idle"}),g(L instanceof Error?L.message:"An error occurred"),n(C=>C.some(H=>H.id===I)?C.map(H=>H.id===I?{...H,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:H):[...C,{id:I,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{s(!1),i(!1),v.current=null}},[t,e,a,l]),T=Pe(()=>{v.current&&(v.current.abort(),v.current=null),i(!1),s(!1)},[]),B=Pe(()=>{n([]),b.current=null,m.current.clear(),f([]);try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:o,isLoading:a,isStreaming:l,error:u,chatStatus:c,currentReasoningSteps:h,sendMessage:R,stopStreaming:T,clearMessages:B}}function hr({token:t,apiBase:e,enabled:r=!0}){const[o,n]=M(null),[a,s]=M(!0),[l,i]=M(null);return ae(()=>{if(!r)return;async function u(){s(!0);try{const g=await fetch(`${e}/api/v1/widget/${t}/config`);if(!g.ok)throw new Error("Failed to load widget configuration");const c=await g.json();n(c)}catch(g){i(g instanceof Error?g.message:"Configuration error"),n({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0,ragType:"simple",showReasoningSteps:!0})}finally{s(!1)}}u()},[t,e,r]),{config:o,isLoading:a,error:l}}function je(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var V=je();function Tt(t){V=t}var se={exec:()=>null};function k(t,e=""){let r=typeof t=="string"?t:t.source,o={replace:(n,a)=>{let s=typeof a=="string"?a:a.source;return s=s.replace(A.caret,"$1"),r=r.replace(n,s),o},getRegex:()=>new RegExp(r,e)};return o}var fr=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),A={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},mr=/^(?:[ \t]*(?:\n|$))+/,br=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,xr=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,ie=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,kr=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,He=/(?:[*+-]|\d{1,9}[.)])/,At=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,It=k(At).replace(/bull/g,He).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),_r=k(At).replace(/bull/g,He).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),qe=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,vr=/^[^\n]+/,We=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,yr=k(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",We).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),wr=k(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,He).getRegex(),ye="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",De=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,Sr=k("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",De).replace("tag",ye).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),Lt=k(qe).replace("hr",ie).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ye).getRegex(),$r=k(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",Lt).getRegex(),Oe={blockquote:$r,code:br,def:yr,fences:xr,heading:kr,hr:ie,html:Sr,lheading:It,list:wr,newline:mr,paragraph:Lt,table:se,text:vr},Mt=k("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",ie).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ye).getRegex(),zr={...Oe,lheading:_r,table:Mt,paragraph:k(qe).replace("hr",ie).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Mt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",ye).getRegex()},Cr={...Oe,html:k(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",De).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:se,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:k(qe).replace("hr",ie).replace("heading",` *#{1,6} *[^
]`).replace("lheading",It).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Rr=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,Tr=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,Bt=/^( {2,}|\\)\n(?!\s*$)/,Ar=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,we=/[\p{P}\p{S}]/u,Ue=/[\s\p{P}\p{S}]/u,Nt=/[^\s\p{P}\p{S}]/u,Ir=k(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Ue).getRegex(),Et=/(?!~)[\p{P}\p{S}]/u,Lr=/(?!~)[\s\p{P}\p{S}]/u,Mr=/(?:[^\s\p{P}\p{S}]|~)/u,Br=k(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",fr?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Pt=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,Nr=k(Pt,"u").replace(/punct/g,we).getRegex(),Er=k(Pt,"u").replace(/punct/g,Et).getRegex(),Ft="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Pr=k(Ft,"gu").replace(/notPunctSpace/g,Nt).replace(/punctSpace/g,Ue).replace(/punct/g,we).getRegex(),Fr=k(Ft,"gu").replace(/notPunctSpace/g,Mr).replace(/punctSpace/g,Lr).replace(/punct/g,Et).getRegex(),jr=k("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Nt).replace(/punctSpace/g,Ue).replace(/punct/g,we).getRegex(),Hr=k(/\\(punct)/,"gu").replace(/punct/g,we).getRegex(),qr=k(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Wr=k(De).replace("(?:-->|$)","-->").getRegex(),Dr=k("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Wr).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),Se=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,Or=k(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",Se).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),jt=k(/^!?\[(label)\]\[(ref)\]/).replace("label",Se).replace("ref",We).getRegex(),Ht=k(/^!?\[(ref)\](?:\[\])?/).replace("ref",We).getRegex(),Ur=k("reflink|nolink(?!\\()","g").replace("reflink",jt).replace("nolink",Ht).getRegex(),qt=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,Ze={_backpedal:se,anyPunctuation:Hr,autolink:qr,blockSkip:Br,br:Bt,code:Tr,del:se,emStrongLDelim:Nr,emStrongRDelimAst:Pr,emStrongRDelimUnd:jr,escape:Rr,link:Or,nolink:Ht,punctuation:Ir,reflink:jt,reflinkSearch:Ur,tag:Dr,text:Ar,url:se},Zr={...Ze,link:k(/^!?\[(label)\]\((.*?)\)/).replace("label",Se).getRegex(),reflink:k(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",Se).getRegex()},Ge={...Ze,emStrongRDelimAst:Fr,emStrongLDelim:Er,url:k(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",qt).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:k(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",qt).getRegex()},Gr={...Ge,br:k(Bt).replace("{2,}","*").getRegex(),text:k(Ge.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},$e={normal:Oe,gfm:zr,pedantic:Cr},de={normal:Ze,gfm:Ge,breaks:Gr,pedantic:Zr},Qr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Wt=t=>Qr[t];function W(t,e){if(e){if(A.escapeTest.test(t))return t.replace(A.escapeReplace,Wt)}else if(A.escapeTestNoEncode.test(t))return t.replace(A.escapeReplaceNoEncode,Wt);return t}function Dt(t){try{t=encodeURI(t).replace(A.percentDecode,"%")}catch{return null}return t}function Ot(t,e){let r=t.replace(A.findPipe,(a,s,l)=>{let i=!1,u=s;for(;--u>=0&&l[u]==="\\";)i=!i;return i?"|":" |"}),o=r.split(A.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(A.slashPipe,"|");return o}function le(t,e,r){let o=t.length;if(o===0)return"";let n=0;for(;n<o&&t.charAt(o-n-1)===e;)n++;return t.slice(0,o-n)}function Vr(t,e){if(t.indexOf(e[1])===-1)return-1;let r=0;for(let o=0;o<t.length;o++)if(t[o]==="\\")o++;else if(t[o]===e[0])r++;else if(t[o]===e[1]&&(r--,r<0))return o;return r>0?-2:-1}function Ut(t,e,r,o,n){let a=e.href,s=e.title||null,l=t[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let i={type:t[0].charAt(0)==="!"?"image":"link",raw:r,href:a,title:s,text:l,tokens:o.inlineTokens(l)};return o.state.inLink=!1,i}function Yr(t,e,r){let o=t.match(r.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(a=>{let s=a.match(r.other.beginningSpace);if(s===null)return a;let[l]=s;return l.length>=n.length?a.slice(n.length):a}).join(`
`)}var ze=class{options;rules;lexer;constructor(t){this.options=t||V}space(t){let e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){let e=this.rules.block.code.exec(t);if(e){let r=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?r:le(r,`
`)}}}fences(t){let e=this.rules.block.fences.exec(t);if(e){let r=e[0],o=Yr(r,e[3]||"",this.rules);return{type:"code",raw:r,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(t){let e=this.rules.block.heading.exec(t);if(e){let r=e[2].trim();if(this.rules.other.endingHash.test(r)){let o=le(r,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(r=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:r,tokens:this.lexer.inline(r)}}}hr(t){let e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:le(e[0],`
`)}}blockquote(t){let e=this.rules.block.blockquote.exec(t);if(e){let r=le(e[0],`
`).split(`
`),o="",n="",a=[];for(;r.length>0;){let s=!1,l=[],i;for(i=0;i<r.length;i++)if(this.rules.other.blockquoteStart.test(r[i]))l.push(r[i]),s=!0;else if(!s)l.push(r[i]);else break;r=r.slice(i);let u=l.join(`
`),g=u.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${u}`:u,n=n?`${n}
${g}`:g;let c=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(g,a,!0),this.lexer.state.top=c,r.length===0)break;let p=a.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){let h=p,f=h.raw+`
`+r.join(`
`),b=this.blockquote(f);a[a.length-1]=b,o=o.substring(0,o.length-h.raw.length)+b.raw,n=n.substring(0,n.length-h.text.length)+b.text;break}else if(p?.type==="list"){let h=p,f=h.raw+`
`+r.join(`
`),b=this.list(f);a[a.length-1]=b,o=o.substring(0,o.length-p.raw.length)+b.raw,n=n.substring(0,n.length-h.raw.length)+b.raw,r=f.substring(a.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:a,text:n}}}list(t){let e=this.rules.block.list.exec(t);if(e){let r=e[1].trim(),o=r.length>1,n={type:"list",raw:"",ordered:o,start:o?+r.slice(0,-1):"",loose:!1,items:[]};r=o?`\\d{1,9}\\${r.slice(-1)}`:`\\${r}`,this.options.pedantic&&(r=o?r:"[*+-]");let a=this.rules.other.listItemRegex(r),s=!1;for(;t;){let i=!1,u="",g="";if(!(e=a.exec(t))||this.rules.block.hr.test(t))break;u=e[0],t=t.substring(u.length);let c=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,b=>" ".repeat(3*b.length)),p=t.split(`
`,1)[0],h=!c.trim(),f=0;if(this.options.pedantic?(f=2,g=c.trimStart()):h?f=e[1].length+1:(f=e[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,g=c.slice(f),f+=e[1].length),h&&this.rules.other.blankLine.test(p)&&(u+=p+`
`,t=t.substring(p.length+1),i=!0),!i){let b=this.rules.other.nextBulletRegex(f),v=this.rules.other.hrRegex(f),x=this.rules.other.fencesBeginRegex(f),m=this.rules.other.headingBeginRegex(f),w=this.rules.other.htmlBeginRegex(f);for(;t;){let R=t.split(`
`,1)[0],T;if(p=R,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),T=p):T=p.replace(this.rules.other.tabCharGlobal,"    "),x.test(p)||m.test(p)||w.test(p)||b.test(p)||v.test(p))break;if(T.search(this.rules.other.nonSpaceChar)>=f||!p.trim())g+=`
`+T.slice(f);else{if(h||c.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||x.test(c)||m.test(c)||v.test(c))break;g+=`
`+p}!h&&!p.trim()&&(h=!0),u+=R+`
`,t=t.substring(R.length+1),c=T.slice(f)}}n.loose||(s?n.loose=!0:this.rules.other.doubleBlankLine.test(u)&&(s=!0)),n.items.push({type:"list_item",raw:u,task:!!this.options.gfm&&this.rules.other.listIsTask.test(g),loose:!1,text:g,tokens:[]}),n.raw+=u}let l=n.items.at(-1);if(l)l.raw=l.raw.trimEnd(),l.text=l.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let i of n.items){if(this.lexer.state.top=!1,i.tokens=this.lexer.blockTokens(i.text,[]),i.task){if(i.text=i.text.replace(this.rules.other.listReplaceTask,""),i.tokens[0]?.type==="text"||i.tokens[0]?.type==="paragraph"){i.tokens[0].raw=i.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),i.tokens[0].text=i.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let g=this.lexer.inlineQueue.length-1;g>=0;g--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[g].src)){this.lexer.inlineQueue[g].src=this.lexer.inlineQueue[g].src.replace(this.rules.other.listReplaceTask,"");break}}let u=this.rules.other.listTaskCheckbox.exec(i.raw);if(u){let g={type:"checkbox",raw:u[0]+" ",checked:u[0]!=="[ ]"};i.checked=g.checked,n.loose?i.tokens[0]&&["paragraph","text"].includes(i.tokens[0].type)&&"tokens"in i.tokens[0]&&i.tokens[0].tokens?(i.tokens[0].raw=g.raw+i.tokens[0].raw,i.tokens[0].text=g.raw+i.tokens[0].text,i.tokens[0].tokens.unshift(g)):i.tokens.unshift({type:"paragraph",raw:g.raw,text:g.raw,tokens:[g]}):i.tokens.unshift(g)}}if(!n.loose){let u=i.tokens.filter(c=>c.type==="space"),g=u.length>0&&u.some(c=>this.rules.other.anyLine.test(c.raw));n.loose=g}}if(n.loose)for(let i of n.items){i.loose=!0;for(let u of i.tokens)u.type==="text"&&(u.type="paragraph")}return n}}html(t){let e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){let e=this.rules.block.def.exec(t);if(e){let r=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:r,raw:e[0],href:o,title:n}}}table(t){let e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let r=Ot(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],a={type:"table",raw:e[0],header:[],align:[],rows:[]};if(r.length===o.length){for(let s of o)this.rules.other.tableAlignRight.test(s)?a.align.push("right"):this.rules.other.tableAlignCenter.test(s)?a.align.push("center"):this.rules.other.tableAlignLeft.test(s)?a.align.push("left"):a.align.push(null);for(let s=0;s<r.length;s++)a.header.push({text:r[s],tokens:this.lexer.inline(r[s]),header:!0,align:a.align[s]});for(let s of n)a.rows.push(Ot(s,a.header.length).map((l,i)=>({text:l,tokens:this.lexer.inline(l),header:!1,align:a.align[i]})));return a}}lheading(t){let e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){let e=this.rules.block.paragraph.exec(t);if(e){let r=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:r,tokens:this.lexer.inline(r)}}}text(t){let e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){let e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){let e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){let e=this.rules.inline.link.exec(t);if(e){let r=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let a=le(r.slice(0,-1),"\\");if((r.length-a.length)%2===0)return}else{let a=Vr(e[2],"()");if(a===-2)return;if(a>-1){let s=(e[0].indexOf("!")===0?5:4)+e[1].length+a;e[2]=e[2].substring(0,a),e[0]=e[0].substring(0,s).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(o);a&&(o=a[1],n=a[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?o=o.slice(1):o=o.slice(1,-1)),Ut(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let r;if((r=this.rules.inline.reflink.exec(t))||(r=this.rules.inline.nolink.exec(t))){let o=(r[2]||r[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let a=r[0].charAt(0);return{type:"text",raw:a,text:a}}return Ut(r,n,r[0],this.lexer,this.rules)}}emStrong(t,e,r=""){let o=this.rules.inline.emStrongLDelim.exec(t);if(!(!o||o[3]&&r.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!r||this.rules.inline.punctuation.exec(r))){let n=[...o[0]].length-1,a,s,l=n,i=0,u=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(u.lastIndex=0,e=e.slice(-1*t.length+n);(o=u.exec(e))!=null;){if(a=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!a)continue;if(s=[...a].length,o[3]||o[4]){l+=s;continue}else if((o[5]||o[6])&&n%3&&!((n+s)%3)){i+=s;continue}if(l-=s,l>0)continue;s=Math.min(s,s+l+i);let g=[...o[0]][0].length,c=t.slice(0,n+o.index+g+s);if(Math.min(n,s)%2){let h=c.slice(1,-1);return{type:"em",raw:c,text:h,tokens:this.lexer.inlineTokens(h)}}let p=c.slice(2,-2);return{type:"strong",raw:c,text:p,tokens:this.lexer.inlineTokens(p)}}}}codespan(t){let e=this.rules.inline.code.exec(t);if(e){let r=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(r),n=this.rules.other.startingSpaceChar.test(r)&&this.rules.other.endingSpaceChar.test(r);return o&&n&&(r=r.substring(1,r.length-1)),{type:"codespan",raw:e[0],text:r}}}br(t){let e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){let e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){let e=this.rules.inline.autolink.exec(t);if(e){let r,o;return e[2]==="@"?(r=e[1],o="mailto:"+r):(r=e[1],o=r),{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}url(t){let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){let e=this.rules.inline.text.exec(t);if(e){let r=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:r}}}},F=class Je{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||V,this.options.tokenizer=this.options.tokenizer||new ze,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let r={other:A,block:$e.normal,inline:de.normal};this.options.pedantic?(r.block=$e.pedantic,r.inline=de.pedantic):this.options.gfm&&(r.block=$e.gfm,this.options.breaks?r.inline=de.breaks:r.inline=de.gfm),this.tokenizer.rules=r}static get rules(){return{block:$e,inline:de}}static lex(e,r){return new Je(r).lex(e)}static lexInline(e,r){return new Je(r).inlineTokens(e)}lex(e){e=e.replace(A.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let r=0;r<this.inlineQueue.length;r++){let o=this.inlineQueue[r];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,r=[],o=!1){for(this.options.pedantic&&(e=e.replace(A.tabCharGlobal,"    ").replace(A.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(s=>(n=s.call({lexer:this},e,r))?(e=e.substring(n.raw.length),r.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let s=r.at(-1);n.raw.length===1&&s!==void 0?s.raw+=`
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
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):r.push(n);continue}if(e){let s="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(s);break}else throw new Error(s)}}return this.state.top=!0,r}inline(e,r=[]){return this.inlineQueue.push({src:e,tokens:r}),r}inlineTokens(e,r=[]){let o=e,n=null;if(this.tokens.links){let i=Object.keys(this.tokens.links);if(i.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)i.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)a=n[2]?n[2].length:0,o=o.slice(0,n.index+a)+"["+"a".repeat(n[0].length-a-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let s=!1,l="";for(;e;){s||(l=""),s=!1;let i;if(this.options.extensions?.inline?.some(g=>(i=g.call({lexer:this},e,r))?(e=e.substring(i.raw.length),r.push(i),!0):!1))continue;if(i=this.tokenizer.escape(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.tag(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.link(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(i.raw.length);let g=r.at(-1);i.type==="text"&&g?.type==="text"?(g.raw+=i.raw,g.text+=i.text):r.push(i);continue}if(i=this.tokenizer.emStrong(e,o,l)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.codespan(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.br(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.del(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.autolink(e)){e=e.substring(i.raw.length),r.push(i);continue}if(!this.state.inLink&&(i=this.tokenizer.url(e))){e=e.substring(i.raw.length),r.push(i);continue}let u=e;if(this.options.extensions?.startInline){let g=1/0,c=e.slice(1),p;this.options.extensions.startInline.forEach(h=>{p=h.call({lexer:this},c),typeof p=="number"&&p>=0&&(g=Math.min(g,p))}),g<1/0&&g>=0&&(u=e.substring(0,g+1))}if(i=this.tokenizer.inlineText(u)){e=e.substring(i.raw.length),i.raw.slice(-1)!=="_"&&(l=i.raw.slice(-1)),s=!0;let g=r.at(-1);g?.type==="text"?(g.raw+=i.raw,g.text+=i.text):r.push(i);continue}if(e){let g="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(g);break}else throw new Error(g)}}return r}},Ce=class{options;parser;constructor(t){this.options=t||V}space(t){return""}code({text:t,lang:e,escaped:r}){let o=(e||"").match(A.notSpaceStart)?.[0],n=t.replace(A.endingNewline,"")+`
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
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${W(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:r}){let o=this.parser.parseInline(r),n=Dt(t);if(n===null)return o;t=n;let a='<a href="'+t+'"';return e&&(a+=' title="'+W(e)+'"'),a+=">"+o+"</a>",a}image({href:t,title:e,text:r,tokens:o}){o&&(r=this.parser.parseInline(o,this.parser.textRenderer));let n=Dt(t);if(n===null)return W(r);t=n;let a=`<img src="${t}" alt="${r}"`;return e&&(a+=` title="${W(e)}"`),a+=">",a}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:W(t.text)}},Qe=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}checkbox({raw:t}){return t}},j=class et{options;renderer;textRenderer;constructor(e){this.options=e||V,this.options.renderer=this.options.renderer||new Ce,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Qe}static parse(e,r){return new et(r).parse(e)}static parseInline(e,r){return new et(r).parseInline(e)}parse(e){let r="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let s=n,l=this.options.extensions.renderers[s.type].call({parser:this},s);if(l!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(s.type)){r+=l||"";continue}}let a=n;switch(a.type){case"space":{r+=this.renderer.space(a);break}case"hr":{r+=this.renderer.hr(a);break}case"heading":{r+=this.renderer.heading(a);break}case"code":{r+=this.renderer.code(a);break}case"table":{r+=this.renderer.table(a);break}case"blockquote":{r+=this.renderer.blockquote(a);break}case"list":{r+=this.renderer.list(a);break}case"checkbox":{r+=this.renderer.checkbox(a);break}case"html":{r+=this.renderer.html(a);break}case"def":{r+=this.renderer.def(a);break}case"paragraph":{r+=this.renderer.paragraph(a);break}case"text":{r+=this.renderer.text(a);break}default:{let s='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(s),"";throw new Error(s)}}}return r}parseInline(e,r=this.renderer){let o="";for(let n=0;n<e.length;n++){let a=e[n];if(this.options.extensions?.renderers?.[a.type]){let l=this.options.extensions.renderers[a.type].call({parser:this},a);if(l!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){o+=l||"";continue}}let s=a;switch(s.type){case"escape":{o+=r.text(s);break}case"html":{o+=r.html(s);break}case"link":{o+=r.link(s);break}case"image":{o+=r.image(s);break}case"checkbox":{o+=r.checkbox(s);break}case"strong":{o+=r.strong(s);break}case"em":{o+=r.em(s);break}case"codespan":{o+=r.codespan(s);break}case"br":{o+=r.br(s);break}case"del":{o+=r.del(s);break}case"text":{o+=r.text(s);break}default:{let l='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(l),"";throw new Error(l)}}}return o}},ue=class{options;block;constructor(t){this.options=t||V}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}emStrongMask(t){return t}provideLexer(){return this.block?F.lex:F.lexInline}provideParser(){return this.block?j.parse:j.parseInline}},Xr=class{defaults=je();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=j;Renderer=Ce;TextRenderer=Qe;Lexer=F;Tokenizer=ze;Hooks=ue;constructor(...t){this.use(...t)}walkTokens(t,e){let r=[];for(let o of t)switch(r=r.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let a of n.header)r=r.concat(this.walkTokens(a.tokens,e));for(let a of n.rows)for(let s of a)r=r.concat(this.walkTokens(s.tokens,e));break}case"list":{let n=o;r=r.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(a=>{let s=n[a].flat(1/0);r=r.concat(this.walkTokens(s,e))}):n.tokens&&(r=r.concat(this.walkTokens(n.tokens,e)))}}return r}use(...t){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(r=>{let o={...r};if(o.async=this.defaults.async||o.async||!1,r.extensions&&(r.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let a=e.renderers[n.name];a?e.renderers[n.name]=function(...s){let l=n.renderer.apply(this,s);return l===!1&&(l=a.apply(this,s)),l}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=e[n.level];a?a.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),r.renderer){let n=this.defaults.renderer||new Ce(this.defaults);for(let a in r.renderer){if(!(a in n))throw new Error(`renderer '${a}' does not exist`);if(["options","parser"].includes(a))continue;let s=a,l=r.renderer[s],i=n[s];n[s]=(...u)=>{let g=l.apply(n,u);return g===!1&&(g=i.apply(n,u)),g||""}}o.renderer=n}if(r.tokenizer){let n=this.defaults.tokenizer||new ze(this.defaults);for(let a in r.tokenizer){if(!(a in n))throw new Error(`tokenizer '${a}' does not exist`);if(["options","rules","lexer"].includes(a))continue;let s=a,l=r.tokenizer[s],i=n[s];n[s]=(...u)=>{let g=l.apply(n,u);return g===!1&&(g=i.apply(n,u)),g}}o.tokenizer=n}if(r.hooks){let n=this.defaults.hooks||new ue;for(let a in r.hooks){if(!(a in n))throw new Error(`hook '${a}' does not exist`);if(["options","block"].includes(a))continue;let s=a,l=r.hooks[s],i=n[s];ue.passThroughHooks.has(a)?n[s]=u=>{if(this.defaults.async&&ue.passThroughHooksRespectAsync.has(a))return(async()=>{let c=await l.call(n,u);return i.call(n,c)})();let g=l.call(n,u);return i.call(n,g)}:n[s]=(...u)=>{if(this.defaults.async)return(async()=>{let c=await l.apply(n,u);return c===!1&&(c=await i.apply(n,u)),c})();let g=l.apply(n,u);return g===!1&&(g=i.apply(n,u)),g}}o.hooks=n}if(r.walkTokens){let n=this.defaults.walkTokens,a=r.walkTokens;o.walkTokens=function(s){let l=[];return l.push(a.call(this,s)),n&&(l=l.concat(n.call(this,s))),l}}this.defaults={...this.defaults,...o}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return F.lex(t,e??this.defaults)}parser(t,e){return j.parse(t,e??this.defaults)}parseMarkdown(t){return(e,r)=>{let o={...r},n={...this.defaults,...o},a=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=t),n.async)return(async()=>{let s=n.hooks?await n.hooks.preprocess(e):e,l=await(n.hooks?await n.hooks.provideLexer():t?F.lex:F.lexInline)(s,n),i=n.hooks?await n.hooks.processAllTokens(l):l;n.walkTokens&&await Promise.all(this.walkTokens(i,n.walkTokens));let u=await(n.hooks?await n.hooks.provideParser():t?j.parse:j.parseInline)(i,n);return n.hooks?await n.hooks.postprocess(u):u})().catch(a);try{n.hooks&&(e=n.hooks.preprocess(e));let s=(n.hooks?n.hooks.provideLexer():t?F.lex:F.lexInline)(e,n);n.hooks&&(s=n.hooks.processAllTokens(s)),n.walkTokens&&this.walkTokens(s,n.walkTokens);let l=(n.hooks?n.hooks.provideParser():t?j.parse:j.parseInline)(s,n);return n.hooks&&(l=n.hooks.postprocess(l)),l}catch(s){return a(s)}}}onError(t,e){return r=>{if(r.message+=`
Please report this to https://github.com/markedjs/marked.`,t){let o="<p>An error occurred:</p><pre>"+W(r.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(r);throw r}}},Y=new Xr;function _(t,e){return Y.parse(t,e)}_.options=_.setOptions=function(t){return Y.setOptions(t),_.defaults=Y.defaults,Tt(_.defaults),_},_.getDefaults=je,_.defaults=V,_.use=function(...t){return Y.use(...t),_.defaults=Y.defaults,Tt(_.defaults),_},_.walkTokens=function(t,e){return Y.walkTokens(t,e)},_.parseInline=Y.parseInline,_.Parser=j,_.parser=j.parse,_.Renderer=Ce,_.TextRenderer=Qe,_.Lexer=F,_.lexer=F.lex,_.Tokenizer=ze,_.Hooks=ue,_.parse=_,_.options,_.setOptions,_.use,_.walkTokens,_.parseInline,j.parse,F.lex;function Kr({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function Zt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),d("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function Jr({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m5 12 7-7 7 7"}),d("path",{d:"M12 19V5"})]})}function Gt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"m6 9 6 6 6-6"})})}function Qt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function Ve({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),d("path",{d:"M5 3v4"}),d("path",{d:"M19 17v4"}),d("path",{d:"M3 5h4"}),d("path",{d:"M17 19h4"})]})}function en({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"15 3 21 3 21 9"}),d("polyline",{points:"9 21 3 21 3 15"}),d("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function tn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"4 14 10 14 10 20"}),d("polyline",{points:"20 10 14 10 14 4"}),d("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function rn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"12",cy:"12",r:"10"}),d("path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}),d("path",{d:"M12 17h.01"})]})}function nn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1"}),d("circle",{cx:"12",cy:"19",r:"0.5",fill:"currentColor"})]})}function on({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})})}function an({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),d("polyline",{points:"14 2 14 8 20 8"})]})}function Vt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"11",cy:"11",r:"8"}),d("path",{d:"m21 21-4.3-4.3"})]})}function Yt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"}),d("path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"}),d("path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"}),d("path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375"}),d("path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5"}),d("path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396"}),d("path",{d:"M19.938 10.5a4 4 0 0 1 .585.396"}),d("path",{d:"M6 18a4 4 0 0 1-1.967-.516"}),d("path",{d:"M19.967 17.484A4 4 0 0 1 18 18"})]})}function sn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}),d("path",{d:"m15 5 4 4"})]})}function dn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M21 12h-8"}),d("path",{d:"M21 6H8"}),d("path",{d:"M21 18h-8"}),d("path",{d:"M3 6v4c0 1.1.9 2 2 2h3"}),d("path",{d:"M3 10v6c0 1.1.9 2 2 2h3"})]})}function ln({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"18",cy:"18",r:"3"}),d("circle",{cx:"6",cy:"6",r:"3"}),d("path",{d:"M6 21V9a9 9 0 0 0 9 9"})]})}function un({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"12",cy:"12",r:"10"}),d("path",{d:"m9 12 2 2 4-4"})]})}function cn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("circle",{cx:"12",cy:"12",r:"10"})})}function gn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"12",cy:"12",r:"10"}),d("line",{x1:"12",y1:"8",x2:"12",y2:"12"}),d("line",{x1:"12",y1:"16",x2:"12.01",y2:"16"})]})}function Xt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M12 2v4"}),d("path",{d:"m16.2 7.8 2.9-2.9"}),d("path",{d:"M18 12h4"}),d("path",{d:"m16.2 16.2 2.9 2.9"}),d("path",{d:"M12 18v4"}),d("path",{d:"m4.9 19.1 2.9-2.9"}),d("path",{d:"M2 12h4"}),d("path",{d:"m4.9 4.9 2.9 2.9"})]})}_.setOptions({breaks:!0,gfm:!0});const Kt=new _.Renderer;Kt.link=({href:t,title:e,text:r})=>{const o=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${o}>${r}</a>`},_.use({renderer:Kt});function pn(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function hn(t){if(!t)return"";let e=t;return e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\(Source:[^)]*\)/gi,""),e=e.replace(/\[\d+\]/g,""),_.parse(e,{async:!1})}function fn({message:t}){const[e,r]=M(!1),o=t.role==="user",n=t.citations&&t.citations.length>0;return d("div",{className:`grounded-message ${t.role}`,children:[d("div",{className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:o?pn(t.content):hn(t.content)}}),t.isStreaming&&d("span",{className:"grounded-cursor"}),!o&&n&&d("div",{className:"grounded-sources",children:[d("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>r(!e),children:[d(Qt,{}),t.citations.length," source",t.citations.length!==1?"s":"",d(Gt,{})]}),d("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((a,s)=>{const l=a.url?.startsWith("upload://"),i=a.title||(l?"Uploaded Document":a.url)||`Source ${s+1}`;return l?d("div",{className:"grounded-source grounded-source-file",children:[d(an,{}),d("span",{className:"grounded-source-title",children:i})]},s):d("a",{href:a.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[d(Qt,{}),d("span",{className:"grounded-source-title",children:i})]},s)})})]})]})}function mn({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return d("div",{className:"grounded-status",children:d("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return d(Vt,{className:"grounded-status-icon"});case"generating":return d(Ve,{className:"grounded-status-icon"});default:return null}})(),d("span",{className:"grounded-status-text",children:e()}),d("div",{className:"grounded-status-dots",children:[d("div",{className:"grounded-typing-dot"}),d("div",{className:"grounded-typing-dot"}),d("div",{className:"grounded-typing-dot"})]})]})})}function bn(t){switch(t){case"rewrite":return sn;case"plan":return dn;case"search":return Vt;case"merge":return ln;case"generate":return Ve;default:return Yt}}function xn(t){switch(t){case"completed":return un;case"in_progress":return Xt;case"error":return gn;default:return cn}}function Jt({steps:t,isStreaming:e=!1,defaultOpen:r=!1}){const[o,n]=M(r);if(t.length===0)return null;const a=t.filter(u=>u.status==="completed").length,s=t.length,l=t.some(u=>u.status==="in_progress"),i=()=>{if(e||l){const u=t.find(g=>g.status==="in_progress");return u?`${u.title}...`:"Processing..."}return a===s&&s>0?`Completed ${s} reasoning steps`:`${a}/${s} steps completed`};return d("div",{className:`grounded-reasoning-panel ${e?"streaming":""}`,children:[d("button",{className:`grounded-reasoning-trigger ${o?"open":""}`,onClick:()=>n(!o),type:"button",children:[d("div",{className:"grounded-reasoning-trigger-icon",children:d(Yt,{})}),d("span",{className:"grounded-reasoning-trigger-text",children:e||l?d("span",{className:"grounded-reasoning-shimmer",children:i()}):i()}),d(Gt,{className:"grounded-reasoning-chevron"})]}),o&&d("div",{className:"grounded-reasoning-content",children:d("div",{className:"grounded-reasoning-timeline",children:t.map((u,g)=>d(kn,{step:u,isLast:g===t.length-1},u.id))})})]})}function kn({step:t,isLast:e=!1}){const r=bn(t.type),o=xn(t.status),n=t.status==="in_progress";return t.status,t.status,d("div",{className:`grounded-reasoning-step ${t.status} ${e?"last":""}`,children:[d("div",{className:`grounded-reasoning-step-dot ${t.status}`}),d("div",{className:`grounded-reasoning-step-icon ${t.status}`,children:d(r,{})}),d("div",{className:"grounded-reasoning-step-content",children:[d("div",{className:"grounded-reasoning-step-title",children:n?d("span",{className:"grounded-reasoning-shimmer",children:t.title}):t.title}),t.summary&&d("div",{className:`grounded-reasoning-step-summary ${t.status}`,children:t.summary})]}),d("div",{className:`grounded-reasoning-step-status ${t.status}`,children:n?d(Xt,{className:"grounded-reasoning-spinner"}):d(o,{})})]})}function er({options:t,initialOpen:e=!1,onOpenChange:r}){const{token:o,apiBase:n="",position:a="bottom-right",showReasoning:s}=t,[l,i]=M(e),[u,g]=M(!1),[c,p]=M(""),h=Q(null),f=Q(null),{config:b,isLoading:v}=hr({token:o,apiBase:n}),x=s??(b?.ragType==="advanced"&&b?.showReasoningSteps!==!1),{messages:m,isLoading:w,isStreaming:R,chatStatus:T,currentReasoningSteps:B,sendMessage:O}=pr({token:o,apiBase:n});ae(()=>{h.current&&h.current.scrollIntoView({behavior:"smooth"})},[m,w,B]),ae(()=>{l&&f.current&&setTimeout(()=>f.current?.focus(),100)},[l]);const D=Q(!1);ae(()=>{D.current&&!w&&l&&setTimeout(()=>f.current?.focus(),50),D.current=w},[w,l]),ae(()=>{r?.(l)},[l,r]);const I=()=>{i(!l)},L=()=>{c.trim()&&!w&&(O(c),p(""),f.current&&(f.current.style.height="auto"),setTimeout(()=>{f.current?.focus()},50))},C=E=>{E.key==="Enter"&&!E.shiftKey&&(E.preventDefault(),L())},N=E=>{const te=E.target;p(te.value),te.style.height="auto",te.style.height=Math.min(te.scrollHeight,120)+"px"},H=a==="bottom-left",Xe=b?.agentName||"Assistant",ce=b?.welcomeMessage||"How can I help?",J=b?.description||"Ask me anything. I'm here to assist you.",U=b?.logoUrl,Ke=m.length===0&&!w,ge=b?.theme?.buttonStyle||"circle",pe=b?.theme?.buttonSize||"medium",S=b?.theme?.buttonText||"Chat with us",P=b?.theme?.buttonIcon||"chat",X=b?.theme?.buttonColor||"#2563eb",ee=b?.theme?.customIconUrl,rr=b?.theme?.customIconSize,Sn=()=>{if(ee){const E=rr?{"--custom-icon-size":`${rr}px`}:void 0;return d("img",{src:ee,alt:"",className:"grounded-launcher-custom-icon",style:E})}switch(P){case"help":return d(rn,{});case"question":return d(nn,{});case"message":return d(on,{});default:return d(Kr,{})}};return d("div",{className:`grounded-container ${H?"left":""}`,children:[d("div",{className:`grounded-window ${l?"open":""} ${u?"expanded":""}`,children:[d("div",{className:"grounded-header",children:[d("div",{className:"grounded-header-left",children:[U&&d("img",{src:U,alt:"",className:"grounded-header-logo"}),d("h2",{className:"grounded-header-title",children:Xe})]}),d("div",{className:"grounded-header-actions",children:[d("button",{className:"grounded-header-btn",onClick:()=>g(!u),"aria-label":u?"Shrink chat":"Expand chat",children:u?d(tn,{}):d(en,{})}),d("button",{className:"grounded-header-btn",onClick:I,"aria-label":"Close chat",children:d(Zt,{})})]})]}),d("div",{className:"grounded-messages",children:d("div",{className:"grounded-messages-inner",children:[Ke?d("div",{className:"grounded-empty",children:[d(Ve,{className:"grounded-empty-icon"}),d("h3",{className:"grounded-empty-title",children:J}),d("p",{className:"grounded-empty-text",children:ce})]}):d(G,{children:[m.map((E,te)=>{const $n=te===m.length-1&&E.role==="assistant"&&x&&B.length>0,zn=E.role==="user"||E.content;return d(G,{children:[$n&&d(Jt,{steps:B,isStreaming:w||R,defaultOpen:!1}),zn&&d(fn,{message:E})]},E.id)}),x&&B.length>0&&m.length>0&&m[m.length-1].role!=="assistant"&&d(Jt,{steps:B,isStreaming:w||R,defaultOpen:!1}),(w||T.status!=="idle")&&T.status!=="streaming"&&(!x||B.length===0)&&d(mn,{status:T})]}),d("div",{ref:h})]})}),d("div",{className:"grounded-input-area",children:d("div",{className:"grounded-input-container",children:[d("textarea",{ref:f,className:"grounded-input",placeholder:v?"Loading...":"Type a message...",value:c,onInput:N,onKeyDown:C,rows:1,disabled:w||v}),d("button",{className:"grounded-send",onClick:L,disabled:!c.trim()||w||v,"aria-label":"Send message",children:d(Jr,{})})]})}),d("div",{className:"grounded-footer",children:["Powered by ",d("a",{href:"https://grounded.ai",target:"_blank",rel:"noopener",children:"Grounded"})]})]}),d("button",{className:`grounded-launcher grounded-launcher--${ge} grounded-launcher--${pe} ${l?"open":""}`,onClick:I,"aria-label":l?"Close chat":"Open chat",style:{backgroundColor:X},children:l?d(Zt,{}):d(G,{children:[Sn(),ge==="pill"&&d("span",{className:"grounded-launcher-text",children:S})]})})]})}const _n=`
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
`;function vn(t){const{containerId:e,containerStyle:r="",colorScheme:o="auto"}=t,n=document.createElement("div");n.id=e,r&&(n.style.cssText=r),document.body.appendChild(n);const a=n.attachShadow({mode:"open"}),s=document.createElement("style");s.textContent=_n,a.appendChild(s),yn(n,o);let l=null,i=null;o==="auto"&&(l=window.matchMedia("(prefers-color-scheme: dark)"),i=()=>{console.log("[Grounded] System theme changed")},l.addEventListener("change",i));const u=document.createElement("div");return u.style.cssText="height:100%;width:100%;",a.appendChild(u),{container:n,shadowRoot:a,mountPoint:u,cleanup:()=>{l&&i&&l.removeEventListener("change",i),n.remove()}}}function yn(t,e){t.classList.remove("light","dark"),e==="light"?t.classList.add("light"):e==="dark"&&t.classList.add("dark")}class wn{constructor(){this.context=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.processQueue()}processQueue(){const e=window.grounded?.q||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,r){switch(e){case"init":this.init(r);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[Grounded Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[Grounded Widget] Already initialized");return}if(!e?.token){console.error("[Grounded Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase(),colorScheme:e.colorScheme||"auto"},this.context=vn({containerId:"grounded-widget-root",colorScheme:this.options.colorScheme}),mt(d(er,{options:this.options,initialOpen:this.openState,onOpenChange:r=>{this.openState=r,this.openCallback?.(r)}}),this.context.mountPoint),this.isInitialized=!0,console.log("[Grounded Widget] Initialized with colorScheme:",this.options.colorScheme)}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const r of e){const o=r.getAttribute("src");if(o)try{return new URL(o,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){!this.context||!this.options||mt(d(er,{options:this.options,initialOpen:this.openState,onOpenChange:e=>{this.openState=e,this.openCallback?.(e)}}),this.context.mountPoint)}destroy(){this.context&&(this.context.cleanup(),this.context=null),this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[Grounded Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const Ye=new wn;function tr(t,e){Ye.handleCommand(t,e)}return window.grounded=tr,window.GroundedWidget=Ye,he.GroundedWidget=Ye,he.grounded=tr,Object.defineProperty(he,Symbol.toStringTag,{value:"Module"}),he})({});
