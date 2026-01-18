var GroundedChat=(function(ke){"use strict";var se,y,Xe,O,Ke,Je,er,rr,ve,ye,we,Y={},tr=[],Yr=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,ie=Array.isArray;function F(r,e){for(var t in e)r[t]=e[t];return r}function Se(r){r&&r.parentNode&&r.parentNode.removeChild(r)}function Xr(r,e,t){var o,n,a,s={};for(a in e)a=="key"?o=e[a]:a=="ref"?n=e[a]:s[a]=e[a];if(arguments.length>2&&(s.children=arguments.length>3?se.call(arguments,2):t),typeof r=="function"&&r.defaultProps!=null)for(a in r.defaultProps)s[a]===void 0&&(s[a]=r.defaultProps[a]);return de(r,s,o,n,null)}function de(r,e,t,o,n){var a={type:r,props:e,key:t,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++Xe,__i:-1,__u:0};return n==null&&y.vnode!=null&&y.vnode(a),a}function Q(r){return r.children}function le(r,e){this.props=r,this.context=e}function V(r,e){if(e==null)return r.__?V(r.__,r.__i+1):null;for(var t;e<r.__k.length;e++)if((t=r.__k[e])!=null&&t.__e!=null)return t.__e;return typeof r.type=="function"?V(r):null}function nr(r){var e,t;if((r=r.__)!=null&&r.__c!=null){for(r.__e=r.__c.base=null,e=0;e<r.__k.length;e++)if((t=r.__k[e])!=null&&t.__e!=null){r.__e=r.__c.base=t.__e;break}return nr(r)}}function or(r){(!r.__d&&(r.__d=!0)&&O.push(r)&&!ue.__r++||Ke!=y.debounceRendering)&&((Ke=y.debounceRendering)||Je)(ue)}function ue(){for(var r,e,t,o,n,a,s,d=1;O.length;)O.length>d&&O.sort(er),r=O.shift(),d=O.length,r.__d&&(t=void 0,o=void 0,n=(o=(e=r).__v).__e,a=[],s=[],e.__P&&((t=F({},o)).__v=o.__v+1,y.vnode&&y.vnode(t),$e(e.__P,t,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,a,n??V(o),!!(32&o.__u),s),t.__v=o.__v,t.__.__k[t.__i]=t,lr(a,t,s),o.__e=o.__=null,t.__e!=n&&nr(t)));ue.__r=0}function ar(r,e,t,o,n,a,s,d,i,l,g){var u,p,h,f,k,v,m,b=o&&o.__k||tr,C=e.length;for(i=Kr(t,e,b,i,C),u=0;u<C;u++)(h=t.__k[u])!=null&&(p=h.__i==-1?Y:b[h.__i]||Y,h.__i=u,v=$e(r,h,p,n,a,s,d,i,l,g),f=h.__e,h.ref&&p.ref!=h.ref&&(p.ref&&Re(p.ref,null,h),g.push(h.ref,h.__c||f,h)),k==null&&f!=null&&(k=f),(m=!!(4&h.__u))||p.__k===h.__k?i=sr(h,i,r,m):typeof h.type=="function"&&v!==void 0?i=v:f&&(i=f.nextSibling),h.__u&=-7);return t.__e=k,i}function Kr(r,e,t,o,n){var a,s,d,i,l,g=t.length,u=g,p=0;for(r.__k=new Array(n),a=0;a<n;a++)(s=e[a])!=null&&typeof s!="boolean"&&typeof s!="function"?(typeof s=="string"||typeof s=="number"||typeof s=="bigint"||s.constructor==String?s=r.__k[a]=de(null,s,null,null,null):ie(s)?s=r.__k[a]=de(Q,{children:s},null,null,null):s.constructor===void 0&&s.__b>0?s=r.__k[a]=de(s.type,s.props,s.key,s.ref?s.ref:null,s.__v):r.__k[a]=s,i=a+p,s.__=r,s.__b=r.__b+1,d=null,(l=s.__i=Jr(s,t,i,u))!=-1&&(u--,(d=t[l])&&(d.__u|=2)),d==null||d.__v==null?(l==-1&&(n>g?p--:n<g&&p++),typeof s.type!="function"&&(s.__u|=4)):l!=i&&(l==i-1?p--:l==i+1?p++:(l>i?p--:p++,s.__u|=4))):r.__k[a]=null;if(u)for(a=0;a<g;a++)(d=t[a])!=null&&(2&d.__u)==0&&(d.__e==o&&(o=V(d)),cr(d,d));return o}function sr(r,e,t,o){var n,a;if(typeof r.type=="function"){for(n=r.__k,a=0;n&&a<n.length;a++)n[a]&&(n[a].__=r,e=sr(n[a],e,t,o));return e}r.__e!=e&&(o&&(e&&r.type&&!e.parentNode&&(e=V(r)),t.insertBefore(r.__e,e||null)),e=r.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function Jr(r,e,t,o){var n,a,s,d=r.key,i=r.type,l=e[t],g=l!=null&&(2&l.__u)==0;if(l===null&&d==null||g&&d==l.key&&i==l.type)return t;if(o>(g?1:0)){for(n=t-1,a=t+1;n>=0||a<e.length;)if((l=e[s=n>=0?n--:a++])!=null&&(2&l.__u)==0&&d==l.key&&i==l.type)return s}return-1}function ir(r,e,t){e[0]=="-"?r.setProperty(e,t??""):r[e]=t==null?"":typeof t!="number"||Yr.test(e)?t:t+"px"}function ce(r,e,t,o,n){var a,s;e:if(e=="style")if(typeof t=="string")r.style.cssText=t;else{if(typeof o=="string"&&(r.style.cssText=o=""),o)for(e in o)t&&e in t||ir(r.style,e,"");if(t)for(e in t)o&&t[e]==o[e]||ir(r.style,e,t[e])}else if(e[0]=="o"&&e[1]=="n")a=e!=(e=e.replace(rr,"$1")),s=e.toLowerCase(),e=s in r||e=="onFocusOut"||e=="onFocusIn"?s.slice(2):e.slice(2),r.l||(r.l={}),r.l[e+a]=t,t?o?t.u=o.u:(t.u=ve,r.addEventListener(e,a?we:ye,a)):r.removeEventListener(e,a?we:ye,a);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in r)try{r[e]=t??"";break e}catch{}typeof t=="function"||(t==null||t===!1&&e[4]!="-"?r.removeAttribute(e):r.setAttribute(e,e=="popover"&&t==1?"":t))}}function dr(r){return function(e){if(this.l){var t=this.l[e.type+r];if(e.t==null)e.t=ve++;else if(e.t<t.u)return;return t(y.event?y.event(e):e)}}}function $e(r,e,t,o,n,a,s,d,i,l){var g,u,p,h,f,k,v,m,b,C,A,L,q,D,W,w,R,T=e.type;if(e.constructor!==void 0)return null;128&t.__u&&(i=!!(32&t.__u),a=[d=e.__e=t.__e]),(g=y.__b)&&g(e);e:if(typeof T=="function")try{if(m=e.props,b="prototype"in T&&T.prototype.render,C=(g=T.contextType)&&o[g.__c],A=g?C?C.props.value:g.__:o,t.__c?v=(u=e.__c=t.__c).__=u.__E:(b?e.__c=u=new T(m,A):(e.__c=u=new le(m,A),u.constructor=T,u.render=rt),C&&C.sub(u),u.state||(u.state={}),u.__n=o,p=u.__d=!0,u.__h=[],u._sb=[]),b&&u.__s==null&&(u.__s=u.state),b&&T.getDerivedStateFromProps!=null&&(u.__s==u.state&&(u.__s=F({},u.__s)),F(u.__s,T.getDerivedStateFromProps(m,u.__s))),h=u.props,f=u.state,u.__v=e,p)b&&T.getDerivedStateFromProps==null&&u.componentWillMount!=null&&u.componentWillMount(),b&&u.componentDidMount!=null&&u.__h.push(u.componentDidMount);else{if(b&&T.getDerivedStateFromProps==null&&m!==h&&u.componentWillReceiveProps!=null&&u.componentWillReceiveProps(m,A),e.__v==t.__v||!u.__e&&u.shouldComponentUpdate!=null&&u.shouldComponentUpdate(m,u.__s,A)===!1){for(e.__v!=t.__v&&(u.props=m,u.state=u.__s,u.__d=!1),e.__e=t.__e,e.__k=t.__k,e.__k.some(function(M){M&&(M.__=e)}),L=0;L<u._sb.length;L++)u.__h.push(u._sb[L]);u._sb=[],u.__h.length&&s.push(u);break e}u.componentWillUpdate!=null&&u.componentWillUpdate(m,u.__s,A),b&&u.componentDidUpdate!=null&&u.__h.push(function(){u.componentDidUpdate(h,f,k)})}if(u.context=A,u.props=m,u.__P=r,u.__e=!1,q=y.__r,D=0,b){for(u.state=u.__s,u.__d=!1,q&&q(e),g=u.render(u.props,u.state,u.context),W=0;W<u._sb.length;W++)u.__h.push(u._sb[W]);u._sb=[]}else do u.__d=!1,q&&q(e),g=u.render(u.props,u.state,u.context),u.state=u.__s;while(u.__d&&++D<25);u.state=u.__s,u.getChildContext!=null&&(o=F(F({},o),u.getChildContext())),b&&!p&&u.getSnapshotBeforeUpdate!=null&&(k=u.getSnapshotBeforeUpdate(h,f)),w=g,g!=null&&g.type===Q&&g.key==null&&(w=ur(g.props.children)),d=ar(r,ie(w)?w:[w],e,t,o,n,a,s,d,i,l),u.base=e.__e,e.__u&=-161,u.__h.length&&s.push(u),v&&(u.__E=u.__=null)}catch(M){if(e.__v=null,i||a!=null)if(M.then){for(e.__u|=i?160:128;d&&d.nodeType==8&&d.nextSibling;)d=d.nextSibling;a[a.indexOf(d)]=null,e.__e=d}else{for(R=a.length;R--;)Se(a[R]);ze(e)}else e.__e=t.__e,e.__k=t.__k,M.then||ze(e);y.__e(M,e,t)}else a==null&&e.__v==t.__v?(e.__k=t.__k,e.__e=t.__e):d=e.__e=et(t.__e,e,t,o,n,a,s,i,l);return(g=y.diffed)&&g(e),128&e.__u?void 0:d}function ze(r){r&&r.__c&&(r.__c.__e=!0),r&&r.__k&&r.__k.forEach(ze)}function lr(r,e,t){for(var o=0;o<t.length;o++)Re(t[o],t[++o],t[++o]);y.__c&&y.__c(e,r),r.some(function(n){try{r=n.__h,n.__h=[],r.some(function(a){a.call(n)})}catch(a){y.__e(a,n.__v)}})}function ur(r){return typeof r!="object"||r==null||r.__b&&r.__b>0?r:ie(r)?r.map(ur):F({},r)}function et(r,e,t,o,n,a,s,d,i){var l,g,u,p,h,f,k,v=t.props||Y,m=e.props,b=e.type;if(b=="svg"?n="http://www.w3.org/2000/svg":b=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),a!=null){for(l=0;l<a.length;l++)if((h=a[l])&&"setAttribute"in h==!!b&&(b?h.localName==b:h.nodeType==3)){r=h,a[l]=null;break}}if(r==null){if(b==null)return document.createTextNode(m);r=document.createElementNS(n,b,m.is&&m),d&&(y.__m&&y.__m(e,a),d=!1),a=null}if(b==null)v===m||d&&r.data==m||(r.data=m);else{if(a=a&&se.call(r.childNodes),!d&&a!=null)for(v={},l=0;l<r.attributes.length;l++)v[(h=r.attributes[l]).name]=h.value;for(l in v)if(h=v[l],l!="children"){if(l=="dangerouslySetInnerHTML")u=h;else if(!(l in m)){if(l=="value"&&"defaultValue"in m||l=="checked"&&"defaultChecked"in m)continue;ce(r,l,null,h,n)}}for(l in m)h=m[l],l=="children"?p=h:l=="dangerouslySetInnerHTML"?g=h:l=="value"?f=h:l=="checked"?k=h:d&&typeof h!="function"||v[l]===h||ce(r,l,h,v[l],n);if(g)d||u&&(g.__html==u.__html||g.__html==r.innerHTML)||(r.innerHTML=g.__html),e.__k=[];else if(u&&(r.innerHTML=""),ar(e.type=="template"?r.content:r,ie(p)?p:[p],e,t,o,b=="foreignObject"?"http://www.w3.org/1999/xhtml":n,a,s,a?a[0]:t.__k&&V(t,0),d,i),a!=null)for(l=a.length;l--;)Se(a[l]);d||(l="value",b=="progress"&&f==null?r.removeAttribute("value"):f!=null&&(f!==r[l]||b=="progress"&&!f||b=="option"&&f!=v[l])&&ce(r,l,f,v[l],n),l="checked",k!=null&&k!=r[l]&&ce(r,l,k,v[l],n))}return r}function Re(r,e,t){try{if(typeof r=="function"){var o=typeof r.__u=="function";o&&r.__u(),o&&e==null||(r.__u=r(e))}else r.current=e}catch(n){y.__e(n,t)}}function cr(r,e,t){var o,n;if(y.unmount&&y.unmount(r),(o=r.ref)&&(o.current&&o.current!=r.__e||Re(o,null,e)),(o=r.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(a){y.__e(a,e)}o.base=o.__P=null}if(o=r.__k)for(n=0;n<o.length;n++)o[n]&&cr(o[n],e,t||typeof r.type!="function");t||Se(r.__e),r.__c=r.__=r.__e=void 0}function rt(r,e,t){return this.constructor(r,t)}function tt(r,e,t){var o,n,a,s;e==document&&(e=document.documentElement),y.__&&y.__(r,e),n=(o=!1)?null:e.__k,a=[],s=[],$e(e,r=e.__k=Xr(Q,null,[r]),n||Y,Y,e.namespaceURI,n?null:e.firstChild?se.call(e.childNodes):null,a,n?n.__e:e.firstChild,o,s),lr(a,r,s)}se=tr.slice,y={__e:function(r,e,t,o){for(var n,a,s;e=e.__;)if((n=e.__c)&&!n.__)try{if((a=n.constructor)&&a.getDerivedStateFromError!=null&&(n.setState(a.getDerivedStateFromError(r)),s=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(r,o||{}),s=n.__d),s)return n.__E=n}catch(d){r=d}throw r}},Xe=0,le.prototype.setState=function(r,e){var t;t=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=F({},this.state),typeof r=="function"&&(r=r(F({},t),this.props)),r&&F(t,r),r!=null&&this.__v&&(e&&this._sb.push(e),or(this))},le.prototype.forceUpdate=function(r){this.__v&&(this.__e=!0,r&&this.__h.push(r),or(this))},le.prototype.render=Q,O=[],Je=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,er=function(r,e){return r.__v.__b-e.__v.__b},ue.__r=0,rr=/(PointerCapture)$|Capture$/i,ve=0,ye=dr(!1),we=dr(!0);var nt=0;function c(r,e,t,o,n,a){e||(e={});var s,d,i=e;if("ref"in i)for(d in i={},e)d=="ref"?s=e[d]:i[d]=e[d];var l={type:r,props:i,key:t,ref:s,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--nt,__i:-1,__u:0,__source:n,__self:a};if(typeof r=="function"&&(s=r.defaultProps))for(d in s)i[d]===void 0&&(i[d]=s[d]);return y.vnode&&y.vnode(l),l}var X,$,Te,gr,K=0,pr=[],z=y,hr=z.__b,fr=z.__r,mr=z.diffed,br=z.__c,xr=z.unmount,_r=z.__;function Ce(r,e){z.__h&&z.__h($,r,K||e),K=0;var t=$.__H||($.__H={__:[],__h:[]});return r>=t.__.length&&t.__.push({}),t.__[r]}function H(r){return K=1,ot(wr,r)}function ot(r,e,t){var o=Ce(X++,2);if(o.t=r,!o.__c&&(o.__=[wr(void 0,e),function(d){var i=o.__N?o.__N[0]:o.__[0],l=o.t(i,d);i!==l&&(o.__N=[l,o.__[1]],o.__c.setState({}))}],o.__c=$,!$.__f)){var n=function(d,i,l){if(!o.__c.__H)return!0;var g=o.__c.__H.__.filter(function(p){return!!p.__c});if(g.every(function(p){return!p.__N}))return!a||a.call(this,d,i,l);var u=o.__c.props!==d;return g.forEach(function(p){if(p.__N){var h=p.__[0];p.__=p.__N,p.__N=void 0,h!==p.__[0]&&(u=!0)}}),a&&a.call(this,d,i,l)||u};$.__f=!0;var a=$.shouldComponentUpdate,s=$.componentWillUpdate;$.componentWillUpdate=function(d,i,l){if(this.__e){var g=a;a=void 0,n(d,i,l),a=g}s&&s.call(this,d,i,l)},$.shouldComponentUpdate=n}return o.__N||o.__}function Ae(r,e){var t=Ce(X++,3);!z.__s&&yr(t.__H,e)&&(t.__=r,t.u=e,$.__H.__h.push(t))}function Z(r){return K=5,kr(function(){return{current:r}},[])}function kr(r,e){var t=Ce(X++,7);return yr(t.__H,e)&&(t.__=r(),t.__H=e,t.__h=r),t.__}function Ie(r,e){return K=8,kr(function(){return r},e)}function at(){for(var r;r=pr.shift();)if(r.__P&&r.__H)try{r.__H.__h.forEach(ge),r.__H.__h.forEach(Le),r.__H.__h=[]}catch(e){r.__H.__h=[],z.__e(e,r.__v)}}z.__b=function(r){$=null,hr&&hr(r)},z.__=function(r,e){r&&e.__k&&e.__k.__m&&(r.__m=e.__k.__m),_r&&_r(r,e)},z.__r=function(r){fr&&fr(r),X=0;var e=($=r.__c).__H;e&&(Te===$?(e.__h=[],$.__h=[],e.__.forEach(function(t){t.__N&&(t.__=t.__N),t.u=t.__N=void 0})):(e.__h.forEach(ge),e.__h.forEach(Le),e.__h=[],X=0)),Te=$},z.diffed=function(r){mr&&mr(r);var e=r.__c;e&&e.__H&&(e.__H.__h.length&&(pr.push(e)!==1&&gr===z.requestAnimationFrame||((gr=z.requestAnimationFrame)||st)(at)),e.__H.__.forEach(function(t){t.u&&(t.__H=t.u),t.u=void 0})),Te=$=null},z.__c=function(r,e){e.some(function(t){try{t.__h.forEach(ge),t.__h=t.__h.filter(function(o){return!o.__||Le(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],z.__e(o,t.__v)}}),br&&br(r,e)},z.unmount=function(r){xr&&xr(r);var e,t=r.__c;t&&t.__H&&(t.__H.__.forEach(function(o){try{ge(o)}catch(n){e=n}}),t.__H=void 0,e&&z.__e(e,t.__v))};var vr=typeof requestAnimationFrame=="function";function st(r){var e,t=function(){clearTimeout(o),vr&&cancelAnimationFrame(e),setTimeout(r)},o=setTimeout(t,35);vr&&(e=requestAnimationFrame(t))}function ge(r){var e=$,t=r.__c;typeof t=="function"&&(r.__c=void 0,t()),$=e}function Le(r){var e=$;r.__c=r.__(),$=e}function yr(r,e){return!r||r.length!==e.length||e.some(function(t,o){return t!==r[o]})}function wr(r,e){return typeof e=="function"?e(r):e}function it({token:r,apiBase:e,endpointType:t="widget"}){const[o,n]=H([]),[a,s]=H(!1),[d,i]=H(!1),[l,g]=H(null),[u,p]=H({status:"idle"}),[h,f]=H([]),k=Z(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${r}`):null),v=Z(null),m=Z(null),b=Z(new Map),C=()=>Math.random().toString(36).slice(2,11),A=Ie(async D=>{if(!D.trim()||a||d)return;const W={id:C(),role:"user",content:D.trim(),timestamp:Date.now()},w=C();n(R=>[...R,W]),s(!0),i(!0),g(null),p({status:"searching",message:"Searching knowledge base..."}),f([]),m.current=null,b.current.clear(),v.current=new AbortController;try{const R={message:D.trim()};k.current&&(R.conversationId=k.current);const T=t==="chat-endpoint"?`${e}/api/v1/c/${r}/chat/stream`:`${e}/api/v1/widget/${r}/chat/stream`,M=await fetch(T,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(R),signal:v.current.signal});if(!M.ok){const oe=await M.json().catch(()=>({}));throw new Error(oe.message||`Request failed: ${M.status}`)}n(oe=>[...oe,{id:w,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),s(!1);const E=M.body?.getReader();if(!E)throw new Error("No response body");const Ze=new TextDecoder;let Ue="",_e="";for(;;){const{done:oe,value:pn}=await E.read();if(oe)break;Ue+=Ze.decode(pn,{stream:!0});const Vr=Ue.split(`
`);Ue=Vr.pop()||"";for(const Ge of Vr)if(Ge.startsWith("data: "))try{const S=JSON.parse(Ge.slice(6));if(S.type==="status"){const N=S.status==="searching"?"searching":S.status==="generating"?"generating":"searching";p({status:N,message:S.message,sourcesCount:S.sourcesCount})}else if(S.type==="sources"&&S.sources)m.current=S.sources.map(N=>({index:N.index,title:N.title,url:N.url,snippet:N.snippet}));else if(S.type==="reasoning"&&S.step)b.current.set(S.step.id,S.step),f(Array.from(b.current.values()));else if(S.type==="text"&&S.content)_e||p({status:"streaming"}),_e+=S.content,n(N=>N.map(ae=>ae.id===w?{...ae,content:_e}:ae));else if(S.type==="done"){if(S.conversationId){k.current=S.conversationId;try{sessionStorage.setItem(`grounded_conv_${r}`,S.conversationId)}catch{}}const N=m.current?[...m.current]:[];m.current=null,b.current.clear(),n(ae=>ae.map(Qe=>Qe.id===w?{...Qe,content:_e,isStreaming:!1,citations:N}:Qe)),p({status:"idle"})}else if(S.type==="error")throw new Error(S.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",Ge)}}}catch(R){if(b.current.clear(),f([]),R.name==="AbortError"){p({status:"idle"});return}p({status:"idle"}),g(R instanceof Error?R.message:"An error occurred"),n(T=>T.some(E=>E.id===w)?T.map(E=>E.id===w?{...E,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:E):[...T,{id:w,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{s(!1),i(!1),v.current=null}},[r,e,a,d]),L=Ie(()=>{v.current&&(v.current.abort(),v.current=null),i(!1),s(!1)},[]),q=Ie(()=>{n([]),k.current=null,b.current.clear(),f([]);try{sessionStorage.removeItem(`grounded_conv_${r}`)}catch{}},[r]);return{messages:o,isLoading:a,isStreaming:d,error:l,chatStatus:u,currentReasoningSteps:h,sendMessage:A,stopStreaming:L,clearMessages:q}}function Me(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var U=Me();function Sr(r){U=r}var J={exec:()=>null};function x(r,e=""){let t=typeof r=="string"?r:r.source,o={replace:(n,a)=>{let s=typeof a=="string"?a:a.source;return s=s.replace(I.caret,"$1"),t=t.replace(n,s),o},getRegex:()=>new RegExp(t,e)};return o}var dt=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),I={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:r=>new RegExp(`^( {0,3}${r})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:r=>new RegExp(`^ {0,${Math.min(3,r-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:r=>new RegExp(`^ {0,${Math.min(3,r-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:r=>new RegExp(`^ {0,${Math.min(3,r-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:r=>new RegExp(`^ {0,${Math.min(3,r-1)}}#`),htmlBeginRegex:r=>new RegExp(`^ {0,${Math.min(3,r-1)}}<(?:[a-z].*>|!--)`,"i")},lt=/^(?:[ \t]*(?:\n|$))+/,ut=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,ct=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,ee=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,gt=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Pe=/(?:[*+-]|\d{1,9}[.)])/,$r=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,zr=x($r).replace(/bull/g,Pe).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),pt=x($r).replace(/bull/g,Pe).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Be=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,ht=/^[^\n]+/,Ee=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,ft=x(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",Ee).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),mt=x(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Pe).getRegex(),pe="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Ne=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,bt=x("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",Ne).replace("tag",pe).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),Rr=x(Be).replace("hr",ee).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",pe).getRegex(),xt=x(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",Rr).getRegex(),Fe={blockquote:xt,code:ut,def:ft,fences:ct,heading:gt,hr:ee,html:bt,lheading:zr,list:mt,newline:lt,paragraph:Rr,table:J,text:ht},Tr=x("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",ee).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",pe).getRegex(),_t={...Fe,lheading:pt,table:Tr,paragraph:x(Be).replace("hr",ee).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Tr).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",pe).getRegex()},kt={...Fe,html:x(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",Ne).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:J,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:x(Be).replace("hr",ee).replace("heading",` *#{1,6} *[^
]`).replace("lheading",zr).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},vt=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,yt=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,Cr=/^( {2,}|\\)\n(?!\s*$)/,wt=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,he=/[\p{P}\p{S}]/u,He=/[\s\p{P}\p{S}]/u,Ar=/[^\s\p{P}\p{S}]/u,St=x(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,He).getRegex(),Ir=/(?!~)[\p{P}\p{S}]/u,$t=/(?!~)[\s\p{P}\p{S}]/u,zt=/(?:[^\s\p{P}\p{S}]|~)/u,Rt=x(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",dt?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),Lr=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,Tt=x(Lr,"u").replace(/punct/g,he).getRegex(),Ct=x(Lr,"u").replace(/punct/g,Ir).getRegex(),Mr="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",At=x(Mr,"gu").replace(/notPunctSpace/g,Ar).replace(/punctSpace/g,He).replace(/punct/g,he).getRegex(),It=x(Mr,"gu").replace(/notPunctSpace/g,zt).replace(/punctSpace/g,$t).replace(/punct/g,Ir).getRegex(),Lt=x("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Ar).replace(/punctSpace/g,He).replace(/punct/g,he).getRegex(),Mt=x(/\\(punct)/,"gu").replace(/punct/g,he).getRegex(),Pt=x(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Bt=x(Ne).replace("(?:-->|$)","-->").getRegex(),Et=x("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Bt).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),fe=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,Nt=x(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",fe).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Pr=x(/^!?\[(label)\]\[(ref)\]/).replace("label",fe).replace("ref",Ee).getRegex(),Br=x(/^!?\[(ref)\](?:\[\])?/).replace("ref",Ee).getRegex(),Ft=x("reflink|nolink(?!\\()","g").replace("reflink",Pr).replace("nolink",Br).getRegex(),Er=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,je={_backpedal:J,anyPunctuation:Mt,autolink:Pt,blockSkip:Rt,br:Cr,code:yt,del:J,emStrongLDelim:Tt,emStrongRDelimAst:At,emStrongRDelimUnd:Lt,escape:vt,link:Nt,nolink:Br,punctuation:St,reflink:Pr,reflinkSearch:Ft,tag:Et,text:wt,url:J},Ht={...je,link:x(/^!?\[(label)\]\((.*?)\)/).replace("label",fe).getRegex(),reflink:x(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",fe).getRegex()},qe={...je,emStrongRDelimAst:It,emStrongLDelim:Ct,url:x(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",Er).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:x(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",Er).getRegex()},jt={...qe,br:x(Cr).replace("{2,}","*").getRegex(),text:x(qe.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},me={normal:Fe,gfm:_t,pedantic:kt},re={normal:je,gfm:qe,breaks:jt,pedantic:Ht},qt={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Nr=r=>qt[r];function j(r,e){if(e){if(I.escapeTest.test(r))return r.replace(I.escapeReplace,Nr)}else if(I.escapeTestNoEncode.test(r))return r.replace(I.escapeReplaceNoEncode,Nr);return r}function Fr(r){try{r=encodeURI(r).replace(I.percentDecode,"%")}catch{return null}return r}function Hr(r,e){let t=r.replace(I.findPipe,(a,s,d)=>{let i=!1,l=s;for(;--l>=0&&d[l]==="\\";)i=!i;return i?"|":" |"}),o=t.split(I.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(I.slashPipe,"|");return o}function te(r,e,t){let o=r.length;if(o===0)return"";let n=0;for(;n<o&&r.charAt(o-n-1)===e;)n++;return r.slice(0,o-n)}function Dt(r,e){if(r.indexOf(e[1])===-1)return-1;let t=0;for(let o=0;o<r.length;o++)if(r[o]==="\\")o++;else if(r[o]===e[0])t++;else if(r[o]===e[1]&&(t--,t<0))return o;return t>0?-2:-1}function jr(r,e,t,o,n){let a=e.href,s=e.title||null,d=r[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let i={type:r[0].charAt(0)==="!"?"image":"link",raw:t,href:a,title:s,text:d,tokens:o.inlineTokens(d)};return o.state.inLink=!1,i}function Wt(r,e,t){let o=r.match(t.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(a=>{let s=a.match(t.other.beginningSpace);if(s===null)return a;let[d]=s;return d.length>=n.length?a.slice(n.length):a}).join(`
`)}var be=class{options;rules;lexer;constructor(r){this.options=r||U}space(r){let e=this.rules.block.newline.exec(r);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(r){let e=this.rules.block.code.exec(r);if(e){let t=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?t:te(t,`
`)}}}fences(r){let e=this.rules.block.fences.exec(r);if(e){let t=e[0],o=Wt(t,e[3]||"",this.rules);return{type:"code",raw:t,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(r){let e=this.rules.block.heading.exec(r);if(e){let t=e[2].trim();if(this.rules.other.endingHash.test(t)){let o=te(t,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(t=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:t,tokens:this.lexer.inline(t)}}}hr(r){let e=this.rules.block.hr.exec(r);if(e)return{type:"hr",raw:te(e[0],`
`)}}blockquote(r){let e=this.rules.block.blockquote.exec(r);if(e){let t=te(e[0],`
`).split(`
`),o="",n="",a=[];for(;t.length>0;){let s=!1,d=[],i;for(i=0;i<t.length;i++)if(this.rules.other.blockquoteStart.test(t[i]))d.push(t[i]),s=!0;else if(!s)d.push(t[i]);else break;t=t.slice(i);let l=d.join(`
`),g=l.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${l}`:l,n=n?`${n}
${g}`:g;let u=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(g,a,!0),this.lexer.state.top=u,t.length===0)break;let p=a.at(-1);if(p?.type==="code")break;if(p?.type==="blockquote"){let h=p,f=h.raw+`
`+t.join(`
`),k=this.blockquote(f);a[a.length-1]=k,o=o.substring(0,o.length-h.raw.length)+k.raw,n=n.substring(0,n.length-h.text.length)+k.text;break}else if(p?.type==="list"){let h=p,f=h.raw+`
`+t.join(`
`),k=this.list(f);a[a.length-1]=k,o=o.substring(0,o.length-p.raw.length)+k.raw,n=n.substring(0,n.length-h.raw.length)+k.raw,t=f.substring(a.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:a,text:n}}}list(r){let e=this.rules.block.list.exec(r);if(e){let t=e[1].trim(),o=t.length>1,n={type:"list",raw:"",ordered:o,start:o?+t.slice(0,-1):"",loose:!1,items:[]};t=o?`\\d{1,9}\\${t.slice(-1)}`:`\\${t}`,this.options.pedantic&&(t=o?t:"[*+-]");let a=this.rules.other.listItemRegex(t),s=!1;for(;r;){let i=!1,l="",g="";if(!(e=a.exec(r))||this.rules.block.hr.test(r))break;l=e[0],r=r.substring(l.length);let u=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,k=>" ".repeat(3*k.length)),p=r.split(`
`,1)[0],h=!u.trim(),f=0;if(this.options.pedantic?(f=2,g=u.trimStart()):h?f=e[1].length+1:(f=e[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,g=u.slice(f),f+=e[1].length),h&&this.rules.other.blankLine.test(p)&&(l+=p+`
`,r=r.substring(p.length+1),i=!0),!i){let k=this.rules.other.nextBulletRegex(f),v=this.rules.other.hrRegex(f),m=this.rules.other.fencesBeginRegex(f),b=this.rules.other.headingBeginRegex(f),C=this.rules.other.htmlBeginRegex(f);for(;r;){let A=r.split(`
`,1)[0],L;if(p=A,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),L=p):L=p.replace(this.rules.other.tabCharGlobal,"    "),m.test(p)||b.test(p)||C.test(p)||k.test(p)||v.test(p))break;if(L.search(this.rules.other.nonSpaceChar)>=f||!p.trim())g+=`
`+L.slice(f);else{if(h||u.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||m.test(u)||b.test(u)||v.test(u))break;g+=`
`+p}!h&&!p.trim()&&(h=!0),l+=A+`
`,r=r.substring(A.length+1),u=L.slice(f)}}n.loose||(s?n.loose=!0:this.rules.other.doubleBlankLine.test(l)&&(s=!0)),n.items.push({type:"list_item",raw:l,task:!!this.options.gfm&&this.rules.other.listIsTask.test(g),loose:!1,text:g,tokens:[]}),n.raw+=l}let d=n.items.at(-1);if(d)d.raw=d.raw.trimEnd(),d.text=d.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let i of n.items){if(this.lexer.state.top=!1,i.tokens=this.lexer.blockTokens(i.text,[]),i.task){if(i.text=i.text.replace(this.rules.other.listReplaceTask,""),i.tokens[0]?.type==="text"||i.tokens[0]?.type==="paragraph"){i.tokens[0].raw=i.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),i.tokens[0].text=i.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let g=this.lexer.inlineQueue.length-1;g>=0;g--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[g].src)){this.lexer.inlineQueue[g].src=this.lexer.inlineQueue[g].src.replace(this.rules.other.listReplaceTask,"");break}}let l=this.rules.other.listTaskCheckbox.exec(i.raw);if(l){let g={type:"checkbox",raw:l[0]+" ",checked:l[0]!=="[ ]"};i.checked=g.checked,n.loose?i.tokens[0]&&["paragraph","text"].includes(i.tokens[0].type)&&"tokens"in i.tokens[0]&&i.tokens[0].tokens?(i.tokens[0].raw=g.raw+i.tokens[0].raw,i.tokens[0].text=g.raw+i.tokens[0].text,i.tokens[0].tokens.unshift(g)):i.tokens.unshift({type:"paragraph",raw:g.raw,text:g.raw,tokens:[g]}):i.tokens.unshift(g)}}if(!n.loose){let l=i.tokens.filter(u=>u.type==="space"),g=l.length>0&&l.some(u=>this.rules.other.anyLine.test(u.raw));n.loose=g}}if(n.loose)for(let i of n.items){i.loose=!0;for(let l of i.tokens)l.type==="text"&&(l.type="paragraph")}return n}}html(r){let e=this.rules.block.html.exec(r);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(r){let e=this.rules.block.def.exec(r);if(e){let t=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:t,raw:e[0],href:o,title:n}}}table(r){let e=this.rules.block.table.exec(r);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let t=Hr(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],a={type:"table",raw:e[0],header:[],align:[],rows:[]};if(t.length===o.length){for(let s of o)this.rules.other.tableAlignRight.test(s)?a.align.push("right"):this.rules.other.tableAlignCenter.test(s)?a.align.push("center"):this.rules.other.tableAlignLeft.test(s)?a.align.push("left"):a.align.push(null);for(let s=0;s<t.length;s++)a.header.push({text:t[s],tokens:this.lexer.inline(t[s]),header:!0,align:a.align[s]});for(let s of n)a.rows.push(Hr(s,a.header.length).map((d,i)=>({text:d,tokens:this.lexer.inline(d),header:!1,align:a.align[i]})));return a}}lheading(r){let e=this.rules.block.lheading.exec(r);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(r){let e=this.rules.block.paragraph.exec(r);if(e){let t=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:t,tokens:this.lexer.inline(t)}}}text(r){let e=this.rules.block.text.exec(r);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(r){let e=this.rules.inline.escape.exec(r);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(r){let e=this.rules.inline.tag.exec(r);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(r){let e=this.rules.inline.link.exec(r);if(e){let t=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(t)){if(!this.rules.other.endAngleBracket.test(t))return;let a=te(t.slice(0,-1),"\\");if((t.length-a.length)%2===0)return}else{let a=Dt(e[2],"()");if(a===-2)return;if(a>-1){let s=(e[0].indexOf("!")===0?5:4)+e[1].length+a;e[2]=e[2].substring(0,a),e[0]=e[0].substring(0,s).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let a=this.rules.other.pedanticHrefTitle.exec(o);a&&(o=a[1],n=a[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(t)?o=o.slice(1):o=o.slice(1,-1)),jr(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(r,e){let t;if((t=this.rules.inline.reflink.exec(r))||(t=this.rules.inline.nolink.exec(r))){let o=(t[2]||t[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let a=t[0].charAt(0);return{type:"text",raw:a,text:a}}return jr(t,n,t[0],this.lexer,this.rules)}}emStrong(r,e,t=""){let o=this.rules.inline.emStrongLDelim.exec(r);if(!(!o||o[3]&&t.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!t||this.rules.inline.punctuation.exec(t))){let n=[...o[0]].length-1,a,s,d=n,i=0,l=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(l.lastIndex=0,e=e.slice(-1*r.length+n);(o=l.exec(e))!=null;){if(a=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!a)continue;if(s=[...a].length,o[3]||o[4]){d+=s;continue}else if((o[5]||o[6])&&n%3&&!((n+s)%3)){i+=s;continue}if(d-=s,d>0)continue;s=Math.min(s,s+d+i);let g=[...o[0]][0].length,u=r.slice(0,n+o.index+g+s);if(Math.min(n,s)%2){let h=u.slice(1,-1);return{type:"em",raw:u,text:h,tokens:this.lexer.inlineTokens(h)}}let p=u.slice(2,-2);return{type:"strong",raw:u,text:p,tokens:this.lexer.inlineTokens(p)}}}}codespan(r){let e=this.rules.inline.code.exec(r);if(e){let t=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(t),n=this.rules.other.startingSpaceChar.test(t)&&this.rules.other.endingSpaceChar.test(t);return o&&n&&(t=t.substring(1,t.length-1)),{type:"codespan",raw:e[0],text:t}}}br(r){let e=this.rules.inline.br.exec(r);if(e)return{type:"br",raw:e[0]}}del(r){let e=this.rules.inline.del.exec(r);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(r){let e=this.rules.inline.autolink.exec(r);if(e){let t,o;return e[2]==="@"?(t=e[1],o="mailto:"+t):(t=e[1],o=t),{type:"link",raw:e[0],text:t,href:o,tokens:[{type:"text",raw:t,text:t}]}}}url(r){let e;if(e=this.rules.inline.url.exec(r)){let t,o;if(e[2]==="@")t=e[0],o="mailto:"+t;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);t=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:t,href:o,tokens:[{type:"text",raw:t,text:t}]}}}inlineText(r){let e=this.rules.inline.text.exec(r);if(e){let t=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:t}}}},P=class Ve{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||U,this.options.tokenizer=this.options.tokenizer||new be,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let t={other:I,block:me.normal,inline:re.normal};this.options.pedantic?(t.block=me.pedantic,t.inline=re.pedantic):this.options.gfm&&(t.block=me.gfm,this.options.breaks?t.inline=re.breaks:t.inline=re.gfm),this.tokenizer.rules=t}static get rules(){return{block:me,inline:re}}static lex(e,t){return new Ve(t).lex(e)}static lexInline(e,t){return new Ve(t).inlineTokens(e)}lex(e){e=e.replace(I.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let t=0;t<this.inlineQueue.length;t++){let o=this.inlineQueue[t];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,t=[],o=!1){for(this.options.pedantic&&(e=e.replace(I.tabCharGlobal,"    ").replace(I.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(s=>(n=s.call({lexer:this},e,t))?(e=e.substring(n.raw.length),t.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let s=t.at(-1);n.raw.length===1&&s!==void 0?s.raw+=`
`:t.push(n);continue}if(n=this.tokenizer.code(e)){e=e.substring(n.raw.length);let s=t.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.at(-1).src=s.text):t.push(n);continue}if(n=this.tokenizer.fences(e)){e=e.substring(n.raw.length),t.push(n);continue}if(n=this.tokenizer.heading(e)){e=e.substring(n.raw.length),t.push(n);continue}if(n=this.tokenizer.hr(e)){e=e.substring(n.raw.length),t.push(n);continue}if(n=this.tokenizer.blockquote(e)){e=e.substring(n.raw.length),t.push(n);continue}if(n=this.tokenizer.list(e)){e=e.substring(n.raw.length),t.push(n);continue}if(n=this.tokenizer.html(e)){e=e.substring(n.raw.length),t.push(n);continue}if(n=this.tokenizer.def(e)){e=e.substring(n.raw.length);let s=t.at(-1);s?.type==="paragraph"||s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.raw,this.inlineQueue.at(-1).src=s.text):this.tokens.links[n.tag]||(this.tokens.links[n.tag]={href:n.href,title:n.title},t.push(n));continue}if(n=this.tokenizer.table(e)){e=e.substring(n.raw.length),t.push(n);continue}if(n=this.tokenizer.lheading(e)){e=e.substring(n.raw.length),t.push(n);continue}let a=e;if(this.options.extensions?.startBlock){let s=1/0,d=e.slice(1),i;this.options.extensions.startBlock.forEach(l=>{i=l.call({lexer:this},d),typeof i=="number"&&i>=0&&(s=Math.min(s,i))}),s<1/0&&s>=0&&(a=e.substring(0,s+1))}if(this.state.top&&(n=this.tokenizer.paragraph(a))){let s=t.at(-1);o&&s?.type==="paragraph"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):t.push(n),o=a.length!==e.length,e=e.substring(n.raw.length);continue}if(n=this.tokenizer.text(e)){e=e.substring(n.raw.length);let s=t.at(-1);s?.type==="text"?(s.raw+=(s.raw.endsWith(`
`)?"":`
`)+n.raw,s.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=s.text):t.push(n);continue}if(e){let s="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(s);break}else throw new Error(s)}}return this.state.top=!0,t}inline(e,t=[]){return this.inlineQueue.push({src:e,tokens:t}),t}inlineTokens(e,t=[]){let o=e,n=null;if(this.tokens.links){let i=Object.keys(this.tokens.links);if(i.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)i.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let a;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)a=n[2]?n[2].length:0,o=o.slice(0,n.index+a)+"["+"a".repeat(n[0].length-a-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let s=!1,d="";for(;e;){s||(d=""),s=!1;let i;if(this.options.extensions?.inline?.some(g=>(i=g.call({lexer:this},e,t))?(e=e.substring(i.raw.length),t.push(i),!0):!1))continue;if(i=this.tokenizer.escape(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.tag(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.link(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(i.raw.length);let g=t.at(-1);i.type==="text"&&g?.type==="text"?(g.raw+=i.raw,g.text+=i.text):t.push(i);continue}if(i=this.tokenizer.emStrong(e,o,d)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.codespan(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.br(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.del(e)){e=e.substring(i.raw.length),t.push(i);continue}if(i=this.tokenizer.autolink(e)){e=e.substring(i.raw.length),t.push(i);continue}if(!this.state.inLink&&(i=this.tokenizer.url(e))){e=e.substring(i.raw.length),t.push(i);continue}let l=e;if(this.options.extensions?.startInline){let g=1/0,u=e.slice(1),p;this.options.extensions.startInline.forEach(h=>{p=h.call({lexer:this},u),typeof p=="number"&&p>=0&&(g=Math.min(g,p))}),g<1/0&&g>=0&&(l=e.substring(0,g+1))}if(i=this.tokenizer.inlineText(l)){e=e.substring(i.raw.length),i.raw.slice(-1)!=="_"&&(d=i.raw.slice(-1)),s=!0;let g=t.at(-1);g?.type==="text"?(g.raw+=i.raw,g.text+=i.text):t.push(i);continue}if(e){let g="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(g);break}else throw new Error(g)}}return t}},xe=class{options;parser;constructor(r){this.options=r||U}space(r){return""}code({text:r,lang:e,escaped:t}){let o=(e||"").match(I.notSpaceStart)?.[0],n=r.replace(I.endingNewline,"")+`
`;return o?'<pre><code class="language-'+j(o)+'">'+(t?n:j(n,!0))+`</code></pre>
`:"<pre><code>"+(t?n:j(n,!0))+`</code></pre>
`}blockquote({tokens:r}){return`<blockquote>
${this.parser.parse(r)}</blockquote>
`}html({text:r}){return r}def(r){return""}heading({tokens:r,depth:e}){return`<h${e}>${this.parser.parseInline(r)}</h${e}>
`}hr(r){return`<hr>
`}list(r){let e=r.ordered,t=r.start,o="";for(let s=0;s<r.items.length;s++){let d=r.items[s];o+=this.listitem(d)}let n=e?"ol":"ul",a=e&&t!==1?' start="'+t+'"':"";return"<"+n+a+`>
`+o+"</"+n+`>
`}listitem(r){return`<li>${this.parser.parse(r.tokens)}</li>
`}checkbox({checked:r}){return"<input "+(r?'checked="" ':"")+'disabled="" type="checkbox"> '}paragraph({tokens:r}){return`<p>${this.parser.parseInline(r)}</p>
`}table(r){let e="",t="";for(let n=0;n<r.header.length;n++)t+=this.tablecell(r.header[n]);e+=this.tablerow({text:t});let o="";for(let n=0;n<r.rows.length;n++){let a=r.rows[n];t="";for(let s=0;s<a.length;s++)t+=this.tablecell(a[s]);o+=this.tablerow({text:t})}return o&&(o=`<tbody>${o}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+o+`</table>
`}tablerow({text:r}){return`<tr>
${r}</tr>
`}tablecell(r){let e=this.parser.parseInline(r.tokens),t=r.header?"th":"td";return(r.align?`<${t} align="${r.align}">`:`<${t}>`)+e+`</${t}>
`}strong({tokens:r}){return`<strong>${this.parser.parseInline(r)}</strong>`}em({tokens:r}){return`<em>${this.parser.parseInline(r)}</em>`}codespan({text:r}){return`<code>${j(r,!0)}</code>`}br(r){return"<br>"}del({tokens:r}){return`<del>${this.parser.parseInline(r)}</del>`}link({href:r,title:e,tokens:t}){let o=this.parser.parseInline(t),n=Fr(r);if(n===null)return o;r=n;let a='<a href="'+r+'"';return e&&(a+=' title="'+j(e)+'"'),a+=">"+o+"</a>",a}image({href:r,title:e,text:t,tokens:o}){o&&(t=this.parser.parseInline(o,this.parser.textRenderer));let n=Fr(r);if(n===null)return j(t);r=n;let a=`<img src="${r}" alt="${t}"`;return e&&(a+=` title="${j(e)}"`),a+=">",a}text(r){return"tokens"in r&&r.tokens?this.parser.parseInline(r.tokens):"escaped"in r&&r.escaped?r.text:j(r.text)}},De=class{strong({text:r}){return r}em({text:r}){return r}codespan({text:r}){return r}del({text:r}){return r}html({text:r}){return r}text({text:r}){return r}link({text:r}){return""+r}image({text:r}){return""+r}br(){return""}checkbox({raw:r}){return r}},B=class Ye{options;renderer;textRenderer;constructor(e){this.options=e||U,this.options.renderer=this.options.renderer||new xe,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new De}static parse(e,t){return new Ye(t).parse(e)}static parseInline(e,t){return new Ye(t).parseInline(e)}parse(e){let t="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let s=n,d=this.options.extensions.renderers[s.type].call({parser:this},s);if(d!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(s.type)){t+=d||"";continue}}let a=n;switch(a.type){case"space":{t+=this.renderer.space(a);break}case"hr":{t+=this.renderer.hr(a);break}case"heading":{t+=this.renderer.heading(a);break}case"code":{t+=this.renderer.code(a);break}case"table":{t+=this.renderer.table(a);break}case"blockquote":{t+=this.renderer.blockquote(a);break}case"list":{t+=this.renderer.list(a);break}case"checkbox":{t+=this.renderer.checkbox(a);break}case"html":{t+=this.renderer.html(a);break}case"def":{t+=this.renderer.def(a);break}case"paragraph":{t+=this.renderer.paragraph(a);break}case"text":{t+=this.renderer.text(a);break}default:{let s='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(s),"";throw new Error(s)}}}return t}parseInline(e,t=this.renderer){let o="";for(let n=0;n<e.length;n++){let a=e[n];if(this.options.extensions?.renderers?.[a.type]){let d=this.options.extensions.renderers[a.type].call({parser:this},a);if(d!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){o+=d||"";continue}}let s=a;switch(s.type){case"escape":{o+=t.text(s);break}case"html":{o+=t.html(s);break}case"link":{o+=t.link(s);break}case"image":{o+=t.image(s);break}case"checkbox":{o+=t.checkbox(s);break}case"strong":{o+=t.strong(s);break}case"em":{o+=t.em(s);break}case"codespan":{o+=t.codespan(s);break}case"br":{o+=t.br(s);break}case"del":{o+=t.del(s);break}case"text":{o+=t.text(s);break}default:{let d='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(d),"";throw new Error(d)}}}return o}},ne=class{options;block;constructor(r){this.options=r||U}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(r){return r}postprocess(r){return r}processAllTokens(r){return r}emStrongMask(r){return r}provideLexer(){return this.block?P.lex:P.lexInline}provideParser(){return this.block?B.parse:B.parseInline}},Ot=class{defaults=Me();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=B;Renderer=xe;TextRenderer=De;Lexer=P;Tokenizer=be;Hooks=ne;constructor(...r){this.use(...r)}walkTokens(r,e){let t=[];for(let o of r)switch(t=t.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let a of n.header)t=t.concat(this.walkTokens(a.tokens,e));for(let a of n.rows)for(let s of a)t=t.concat(this.walkTokens(s.tokens,e));break}case"list":{let n=o;t=t.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(a=>{let s=n[a].flat(1/0);t=t.concat(this.walkTokens(s,e))}):n.tokens&&(t=t.concat(this.walkTokens(n.tokens,e)))}}return t}use(...r){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return r.forEach(t=>{let o={...t};if(o.async=this.defaults.async||o.async||!1,t.extensions&&(t.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let a=e.renderers[n.name];a?e.renderers[n.name]=function(...s){let d=n.renderer.apply(this,s);return d===!1&&(d=a.apply(this,s)),d}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let a=e[n.level];a?a.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),t.renderer){let n=this.defaults.renderer||new xe(this.defaults);for(let a in t.renderer){if(!(a in n))throw new Error(`renderer '${a}' does not exist`);if(["options","parser"].includes(a))continue;let s=a,d=t.renderer[s],i=n[s];n[s]=(...l)=>{let g=d.apply(n,l);return g===!1&&(g=i.apply(n,l)),g||""}}o.renderer=n}if(t.tokenizer){let n=this.defaults.tokenizer||new be(this.defaults);for(let a in t.tokenizer){if(!(a in n))throw new Error(`tokenizer '${a}' does not exist`);if(["options","rules","lexer"].includes(a))continue;let s=a,d=t.tokenizer[s],i=n[s];n[s]=(...l)=>{let g=d.apply(n,l);return g===!1&&(g=i.apply(n,l)),g}}o.tokenizer=n}if(t.hooks){let n=this.defaults.hooks||new ne;for(let a in t.hooks){if(!(a in n))throw new Error(`hook '${a}' does not exist`);if(["options","block"].includes(a))continue;let s=a,d=t.hooks[s],i=n[s];ne.passThroughHooks.has(a)?n[s]=l=>{if(this.defaults.async&&ne.passThroughHooksRespectAsync.has(a))return(async()=>{let u=await d.call(n,l);return i.call(n,u)})();let g=d.call(n,l);return i.call(n,g)}:n[s]=(...l)=>{if(this.defaults.async)return(async()=>{let u=await d.apply(n,l);return u===!1&&(u=await i.apply(n,l)),u})();let g=d.apply(n,l);return g===!1&&(g=i.apply(n,l)),g}}o.hooks=n}if(t.walkTokens){let n=this.defaults.walkTokens,a=t.walkTokens;o.walkTokens=function(s){let d=[];return d.push(a.call(this,s)),n&&(d=d.concat(n.call(this,s))),d}}this.defaults={...this.defaults,...o}}),this}setOptions(r){return this.defaults={...this.defaults,...r},this}lexer(r,e){return P.lex(r,e??this.defaults)}parser(r,e){return B.parse(r,e??this.defaults)}parseMarkdown(r){return(e,t)=>{let o={...t},n={...this.defaults,...o},a=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return a(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return a(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return a(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=r),n.async)return(async()=>{let s=n.hooks?await n.hooks.preprocess(e):e,d=await(n.hooks?await n.hooks.provideLexer():r?P.lex:P.lexInline)(s,n),i=n.hooks?await n.hooks.processAllTokens(d):d;n.walkTokens&&await Promise.all(this.walkTokens(i,n.walkTokens));let l=await(n.hooks?await n.hooks.provideParser():r?B.parse:B.parseInline)(i,n);return n.hooks?await n.hooks.postprocess(l):l})().catch(a);try{n.hooks&&(e=n.hooks.preprocess(e));let s=(n.hooks?n.hooks.provideLexer():r?P.lex:P.lexInline)(e,n);n.hooks&&(s=n.hooks.processAllTokens(s)),n.walkTokens&&this.walkTokens(s,n.walkTokens);let d=(n.hooks?n.hooks.provideParser():r?B.parse:B.parseInline)(s,n);return n.hooks&&(d=n.hooks.postprocess(d)),d}catch(s){return a(s)}}}onError(r,e){return t=>{if(t.message+=`
Please report this to https://github.com/markedjs/marked.`,r){let o="<p>An error occurred:</p><pre>"+j(t.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(t);throw t}}},G=new Ot;function _(r,e){return G.parse(r,e)}_.options=_.setOptions=function(r){return G.setOptions(r),_.defaults=G.defaults,Sr(_.defaults),_},_.getDefaults=Me,_.defaults=U,_.use=function(...r){return G.use(...r),_.defaults=G.defaults,Sr(_.defaults),_},_.walkTokens=function(r,e){return G.walkTokens(r,e)},_.parseInline=G.parseInline,_.Parser=B,_.parser=B.parse,_.Renderer=xe,_.TextRenderer=De,_.Lexer=P,_.lexer=P.lex,_.Tokenizer=be,_.Hooks=ne,_.parse=_,_.options,_.setOptions,_.use,_.walkTokens,_.parseInline,B.parse,P.lex;function Zt({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("path",{d:"m5 12 7-7 7 7"}),c("path",{d:"M12 19V5"})]})}function qr({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:c("path",{d:"m6 9 6 6 6-6"})})}function Dr({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:c("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function We({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),c("path",{d:"M5 3v4"}),c("path",{d:"M19 17v4"}),c("path",{d:"M3 5h4"}),c("path",{d:"M17 19h4"})]})}function Ut({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),c("polyline",{points:"14 2 14 8 20 8"})]})}function Wr({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("circle",{cx:"11",cy:"11",r:"8"}),c("path",{d:"m21 21-4.3-4.3"})]})}function Or({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"}),c("path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"}),c("path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"}),c("path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375"}),c("path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5"}),c("path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396"}),c("path",{d:"M19.938 10.5a4 4 0 0 1 .585.396"}),c("path",{d:"M6 18a4 4 0 0 1-1.967-.516"}),c("path",{d:"M19.967 17.484A4 4 0 0 1 18 18"})]})}function Gt({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"}),c("path",{d:"m15 5 4 4"})]})}function Qt({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("path",{d:"M21 12h-8"}),c("path",{d:"M21 6H8"}),c("path",{d:"M21 18h-8"}),c("path",{d:"M3 6v4c0 1.1.9 2 2 2h3"}),c("path",{d:"M3 10v6c0 1.1.9 2 2 2h3"})]})}function Vt({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("circle",{cx:"18",cy:"18",r:"3"}),c("circle",{cx:"6",cy:"6",r:"3"}),c("path",{d:"M6 21V9a9 9 0 0 0 9 9"})]})}function Yt({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("circle",{cx:"12",cy:"12",r:"10"}),c("path",{d:"m9 12 2 2 4-4"})]})}function Xt({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:c("circle",{cx:"12",cy:"12",r:"10"})})}function Kt({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("circle",{cx:"12",cy:"12",r:"10"}),c("line",{x1:"12",y1:"8",x2:"12",y2:"12"}),c("line",{x1:"12",y1:"16",x2:"12.01",y2:"16"})]})}function Zr({className:r}){return c("svg",{className:r,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[c("path",{d:"M12 2v4"}),c("path",{d:"m16.2 7.8 2.9-2.9"}),c("path",{d:"M18 12h4"}),c("path",{d:"m16.2 16.2 2.9 2.9"}),c("path",{d:"M12 18v4"}),c("path",{d:"m4.9 19.1 2.9-2.9"}),c("path",{d:"M2 12h4"}),c("path",{d:"m4.9 4.9 2.9 2.9"})]})}_.setOptions({breaks:!0,gfm:!0});const Ur=new _.Renderer;Ur.link=({href:r,title:e,text:t})=>{const o=e?` title="${e}"`:"";return`<a href="${r}" target="_blank" rel="noopener noreferrer"${o}>${t}</a>`},_.use({renderer:Ur});function Jt(r){const e=document.createElement("div");return e.textContent=r,e.innerHTML}function en(r){if(!r)return"";let e=r;return e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\(Source:[^)]*\)/gi,""),e=e.replace(/\[\d+\]/g,""),_.parse(e,{async:!1})}function rn({message:r}){const[e,t]=H(!1),o=r.role==="user",n=r.citations&&r.citations.length>0;return c("div",{className:`grounded-message ${r.role}`,children:[c("div",{className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:o?Jt(r.content):en(r.content)}}),r.isStreaming&&c("span",{className:"grounded-cursor"}),!o&&n&&c("div",{className:"grounded-sources",children:[c("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>t(!e),children:[c(Dr,{}),r.citations.length," source",r.citations.length!==1?"s":"",c(qr,{})]}),c("div",{className:`grounded-sources-list ${e?"open":""}`,children:r.citations.map((a,s)=>{const d=a.url?.startsWith("upload://"),i=a.title||(d?"Uploaded Document":a.url)||`Source ${s+1}`;return d?c("div",{className:"grounded-source grounded-source-file",children:[c(Ut,{}),c("span",{className:"grounded-source-title",children:i})]},s):c("a",{href:a.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[c(Dr,{}),c("span",{className:"grounded-source-title",children:i})]},s)})})]})]})}function tn({status:r}){const e=()=>{if(r.message)return r.message;switch(r.status){case"searching":return"Searching knowledge base...";case"generating":return r.sourcesCount?`Found ${r.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return c("div",{className:"grounded-status",children:c("div",{className:"grounded-status-content",children:[(()=>{switch(r.status){case"searching":return c(Wr,{className:"grounded-status-icon"});case"generating":return c(We,{className:"grounded-status-icon"});default:return null}})(),c("span",{className:"grounded-status-text",children:e()}),c("div",{className:"grounded-status-dots",children:[c("div",{className:"grounded-typing-dot"}),c("div",{className:"grounded-typing-dot"}),c("div",{className:"grounded-typing-dot"})]})]})})}function nn(r){switch(r){case"rewrite":return Gt;case"plan":return Qt;case"search":return Wr;case"merge":return Vt;case"generate":return We;default:return Or}}function on(r){switch(r){case"completed":return Yt;case"in_progress":return Zr;case"error":return Kt;default:return Xt}}function Gr({steps:r,isStreaming:e=!1,defaultOpen:t=!1}){const[o,n]=H(t);if(r.length===0)return null;const a=r.filter(l=>l.status==="completed").length,s=r.length,d=r.some(l=>l.status==="in_progress"),i=()=>{if(e||d){const l=r.find(g=>g.status==="in_progress");return l?`${l.title}...`:"Processing..."}return a===s&&s>0?`Completed ${s} reasoning steps`:`${a}/${s} steps completed`};return c("div",{className:`grounded-reasoning-panel ${e?"streaming":""}`,children:[c("button",{className:`grounded-reasoning-trigger ${o?"open":""}`,onClick:()=>n(!o),type:"button",children:[c("div",{className:"grounded-reasoning-trigger-icon",children:c(Or,{})}),c("span",{className:"grounded-reasoning-trigger-text",children:e||d?c("span",{className:"grounded-reasoning-shimmer",children:i()}):i()}),c(qr,{className:"grounded-reasoning-chevron"})]}),o&&c("div",{className:"grounded-reasoning-content",children:c("div",{className:"grounded-reasoning-timeline",children:r.map((l,g)=>c(an,{step:l,isLast:g===r.length-1},l.id))})})]})}function an({step:r,isLast:e=!1}){const t=nn(r.type),o=on(r.status),n=r.status==="in_progress";return r.status,r.status,c("div",{className:`grounded-reasoning-step ${r.status} ${e?"last":""}`,children:[c("div",{className:`grounded-reasoning-step-dot ${r.status}`}),c("div",{className:`grounded-reasoning-step-icon ${r.status}`,children:c(t,{})}),c("div",{className:"grounded-reasoning-step-content",children:[c("div",{className:"grounded-reasoning-step-title",children:n?c("span",{className:"grounded-reasoning-shimmer",children:r.title}):r.title}),r.summary&&c("div",{className:`grounded-reasoning-step-summary ${r.status}`,children:r.summary})]}),c("div",{className:`grounded-reasoning-step-status ${r.status}`,children:n?c(Zr,{className:"grounded-reasoning-spinner"}):c(o,{})})]})}function sn({config:r}){const{token:e,apiBase:t,agentName:o,welcomeMessage:n,logoUrl:a,ragType:s,showReasoningSteps:d}=r,[i,l]=H(""),g=Z(null),u=Z(null),p=s==="advanced"&&d!==!1,{messages:h,isLoading:f,isStreaming:k,chatStatus:v,currentReasoningSteps:m,sendMessage:b}=it({token:e,apiBase:t,endpointType:"chat-endpoint"});Ae(()=>{g.current&&g.current.scrollIntoView({behavior:"smooth"})},[h,f,m]),Ae(()=>{u.current?.focus()},[]);const C=Z(!1);Ae(()=>{C.current&&!f&&setTimeout(()=>u.current?.focus(),50),C.current=f},[f]);const A=()=>{i.trim()&&!f&&(b(i),l(""),u.current&&(u.current.style.height="auto"),setTimeout(()=>u.current?.focus(),50))},L=w=>{w.key==="Enter"&&!w.shiftKey&&(w.preventDefault(),A())},q=w=>{const R=w.target;l(R.value),R.style.height="auto",R.style.height=Math.min(R.scrollHeight,120)+"px"},D=h.length===0&&!f,W=o.charAt(0).toUpperCase();return c("div",{className:"grounded-fullpage",children:[c("div",{className:"grounded-fullpage-header",children:[a?c("img",{src:a,alt:"",className:"grounded-fullpage-logo"}):c("div",{className:"grounded-fullpage-avatar",children:W}),c("div",{className:"grounded-fullpage-info",children:c("h1",{children:o})})]}),c("div",{className:"grounded-fullpage-messages",children:c("div",{className:"grounded-fullpage-messages-inner",children:[D?c("div",{className:"grounded-fullpage-welcome",children:[c(We,{className:"grounded-fullpage-welcome-icon"}),c("h2",{children:n}),c("p",{children:"Ask me anything. I'm here to help."})]}):c(Q,{children:[h.map((w,R)=>{const E=R===h.length-1&&w.role==="assistant"&&p&&m.length>0,Ze=w.role==="user"||w.content;return c(Q,{children:[E&&c(Gr,{steps:m,isStreaming:f||k,defaultOpen:!1}),Ze&&c(rn,{message:w})]},w.id)}),p&&m.length>0&&h.length>0&&h[h.length-1].role!=="assistant"&&c(Gr,{steps:m,isStreaming:f||k,defaultOpen:!1}),(f||v.status!=="idle")&&v.status!=="streaming"&&(!p||m.length===0)&&c(tn,{status:v})]}),c("div",{ref:g})]})}),c("div",{className:"grounded-fullpage-input-area",children:c("div",{className:"grounded-fullpage-input-container",children:[c("textarea",{ref:u,className:"grounded-fullpage-input",placeholder:`Ask ${o} anything...`,value:i,onInput:q,onKeyDown:L,rows:1,disabled:f}),c("button",{className:"grounded-fullpage-send",onClick:A,disabled:!i.trim()||f,"aria-label":"Send message",children:c(Zt,{})})]})}),c("div",{className:"grounded-fullpage-footer",children:["Powered by ",c("a",{href:"https://github.com/grounded-ai",target:"_blank",rel:"noopener noreferrer",children:"Grounded"})]})]})}const dn=`
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
`;function ln(r){const{containerId:e,containerStyle:t="",colorScheme:o="auto"}=r,n=document.createElement("div");n.id=e,t&&(n.style.cssText=t),document.body.appendChild(n);const a=n.attachShadow({mode:"open"}),s=document.createElement("style");s.textContent=dn,a.appendChild(s),un(n,o);let d=null,i=null;o==="auto"&&(d=window.matchMedia("(prefers-color-scheme: dark)"),i=()=>{console.log("[Grounded] System theme changed")},d.addEventListener("change",i));const l=document.createElement("div");return l.style.cssText="height:100%;width:100%;",a.appendChild(l),{container:n,shadowRoot:a,mountPoint:l,cleanup:()=>{d&&i&&d.removeEventListener("change",i),n.remove()}}}function un(r,e){r.classList.remove("light","dark"),e==="light"?r.classList.add("light"):e==="dark"&&r.classList.add("dark")}class cn{constructor(){this.context=null,this.mounted=!1}init(e){if(this.mounted){console.warn("[Grounded Chat] Already initialized");return}if(!e?.token){console.error("[Grounded Chat] Token is required");return}const t=e.colorScheme||"auto";this.context=ln({containerId:"grounded-chat-container",containerStyle:"position:fixed;inset:0;z-index:2147483647;",colorScheme:t}),tt(c(sn,{config:e}),this.context.mountPoint),this.mounted=!0,console.log("[Grounded Chat] Initialized with colorScheme:",t)}destroy(){this.context&&(this.context.cleanup(),this.context=null),this.mounted=!1,console.log("[Grounded Chat] Destroyed")}}const Qr=new cn;function Oe(r,e){r==="init"?Qr.init(e):r==="destroy"&&Qr.destroy()}const gn=window.groundedChat?.q||[];for(const r of gn)Oe(r[0],r[1]);return window.groundedChat=Oe,ke.groundedChat=Oe,Object.defineProperty(ke,Symbol.toStringTag,{value:"Module"}),ke})({});
