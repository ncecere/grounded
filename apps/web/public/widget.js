var GroundedWidget=function(q){"use strict";var cr=Object.defineProperty;var pr=(q,B,b)=>B in q?cr(q,B,{enumerable:!0,configurable:!0,writable:!0,value:b}):q[B]=b;var y=(q,B,b)=>pr(q,typeof B!="symbol"?B+"":B,b);var Ze;var B,b,Xe,Q,Ke,Je,et,tt,$e,Ce,Re,ee={},nt=[],Jt=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,ue=Array.isArray;function j(t,e){for(var n in e)t[n]=e[n];return t}function ze(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function en(t,e,n){var r,o,s,l={};for(s in e)s=="key"?r=e[s]:s=="ref"?o=e[s]:l[s]=e[s];if(arguments.length>2&&(l.children=arguments.length>3?B.call(arguments,2):n),typeof t=="function"&&t.defaultProps!=null)for(s in t.defaultProps)l[s]===void 0&&(l[s]=t.defaultProps[s]);return ce(t,l,r,o,null)}function ce(t,e,n,r,o){var s={type:t,props:e,key:n,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:o??++Xe,__i:-1,__u:0};return o==null&&b.vnode!=null&&b.vnode(s),s}function X(t){return t.children}function pe(t,e){this.props=t,this.context=e}function K(t,e){if(e==null)return t.__?K(t.__,t.__i+1):null;for(var n;e<t.__k.length;e++)if((n=t.__k[e])!=null&&n.__e!=null)return n.__e;return typeof t.type=="function"?K(t):null}function rt(t){var e,n;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((n=t.__k[e])!=null&&n.__e!=null){t.__e=t.__c.base=n.__e;break}return rt(t)}}function ot(t){(!t.__d&&(t.__d=!0)&&Q.push(t)&&!he.__r++||Ke!=b.debounceRendering)&&((Ke=b.debounceRendering)||Je)(he)}function he(){for(var t,e,n,r,o,s,l,i=1;Q.length;)Q.length>i&&Q.sort(et),t=Q.shift(),i=Q.length,t.__d&&(n=void 0,r=void 0,o=(r=(e=t).__v).__e,s=[],l=[],e.__P&&((n=j({},r)).__v=r.__v+1,b.vnode&&b.vnode(n),Te(e.__P,n,r,e.__n,e.__P.namespaceURI,32&r.__u?[o]:null,s,o??K(r),!!(32&r.__u),l),n.__v=r.__v,n.__.__k[n.__i]=n,dt(s,n,l),r.__e=r.__=null,n.__e!=o&&rt(n)));he.__r=0}function st(t,e,n,r,o,s,l,i,c,a,d){var u,h,f,g,k,v,m,_=r&&r.__k||nt,A=e.length;for(c=tn(n,e,_,c,A),u=0;u<A;u++)(f=n.__k[u])!=null&&(h=f.__i==-1?ee:_[f.__i]||ee,f.__i=u,v=Te(t,f,h,o,s,l,i,c,a,d),g=f.__e,f.ref&&h.ref!=f.ref&&(h.ref&&Le(h.ref,null,f),d.push(f.ref,f.__c||g,f)),k==null&&g!=null&&(k=g),(m=!!(4&f.__u))||h.__k===f.__k?c=it(f,c,t,m):typeof f.type=="function"&&v!==void 0?c=v:g&&(c=g.nextSibling),f.__u&=-7);return n.__e=k,c}function tn(t,e,n,r,o){var s,l,i,c,a,d=n.length,u=d,h=0;for(t.__k=new Array(o),s=0;s<o;s++)(l=e[s])!=null&&typeof l!="boolean"&&typeof l!="function"?(typeof l=="string"||typeof l=="number"||typeof l=="bigint"||l.constructor==String?l=t.__k[s]=ce(null,l,null,null,null):ue(l)?l=t.__k[s]=ce(X,{children:l},null,null,null):l.constructor===void 0&&l.__b>0?l=t.__k[s]=ce(l.type,l.props,l.key,l.ref?l.ref:null,l.__v):t.__k[s]=l,c=s+h,l.__=t,l.__b=t.__b+1,i=null,(a=l.__i=nn(l,n,c,u))!=-1&&(u--,(i=n[a])&&(i.__u|=2)),i==null||i.__v==null?(a==-1&&(o>d?h--:o<d&&h++),typeof l.type!="function"&&(l.__u|=4)):a!=c&&(a==c-1?h--:a==c+1?h++:(a>c?h--:h++,l.__u|=4))):t.__k[s]=null;if(u)for(s=0;s<d;s++)(i=n[s])!=null&&!(2&i.__u)&&(i.__e==r&&(r=K(i)),ct(i,i));return r}function it(t,e,n,r){var o,s;if(typeof t.type=="function"){for(o=t.__k,s=0;o&&s<o.length;s++)o[s]&&(o[s].__=t,e=it(o[s],e,n,r));return e}t.__e!=e&&(r&&(e&&t.type&&!e.parentNode&&(e=K(t)),n.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function nn(t,e,n,r){var o,s,l,i=t.key,c=t.type,a=e[n],d=a!=null&&(2&a.__u)==0;if(a===null&&i==null||d&&i==a.key&&c==a.type)return n;if(r>(d?1:0)){for(o=n-1,s=n+1;o>=0||s<e.length;)if((a=e[l=o>=0?o--:s++])!=null&&!(2&a.__u)&&i==a.key&&c==a.type)return l}return-1}function at(t,e,n){e[0]=="-"?t.setProperty(e,n??""):t[e]=n==null?"":typeof n!="number"||Jt.test(e)?n:n+"px"}function ge(t,e,n,r,o){var s,l;e:if(e=="style")if(typeof n=="string")t.style.cssText=n;else{if(typeof r=="string"&&(t.style.cssText=r=""),r)for(e in r)n&&e in n||at(t.style,e,"");if(n)for(e in n)r&&n[e]==r[e]||at(t.style,e,n[e])}else if(e[0]=="o"&&e[1]=="n")s=e!=(e=e.replace(tt,"$1")),l=e.toLowerCase(),e=l in t||e=="onFocusOut"||e=="onFocusIn"?l.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+s]=n,n?r?n.u=r.u:(n.u=$e,t.addEventListener(e,s?Re:Ce,s)):t.removeEventListener(e,s?Re:Ce,s);else{if(o=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=n??"";break e}catch{}typeof n=="function"||(n==null||n===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&n==1?"":n))}}function lt(t){return function(e){if(this.l){var n=this.l[e.type+t];if(e.t==null)e.t=$e++;else if(e.t<n.u)return;return n(b.event?b.event(e):e)}}}function Te(t,e,n,r,o,s,l,i,c,a){var d,u,h,f,g,k,v,m,_,A,C,M,R,T,D,P,G,I=e.type;if(e.constructor!==void 0)return null;128&n.__u&&(c=!!(32&n.__u),s=[i=e.__e=n.__e]),(d=b.__b)&&d(e);e:if(typeof I=="function")try{if(m=e.props,_="prototype"in I&&I.prototype.render,A=(d=I.contextType)&&r[d.__c],C=d?A?A.props.value:d.__:r,n.__c?v=(u=e.__c=n.__c).__=u.__E:(_?e.__c=u=new I(m,C):(e.__c=u=new pe(m,C),u.constructor=I,u.render=on),A&&A.sub(u),u.state||(u.state={}),u.__n=r,h=u.__d=!0,u.__h=[],u._sb=[]),_&&u.__s==null&&(u.__s=u.state),_&&I.getDerivedStateFromProps!=null&&(u.__s==u.state&&(u.__s=j({},u.__s)),j(u.__s,I.getDerivedStateFromProps(m,u.__s))),f=u.props,g=u.state,u.__v=e,h)_&&I.getDerivedStateFromProps==null&&u.componentWillMount!=null&&u.componentWillMount(),_&&u.componentDidMount!=null&&u.__h.push(u.componentDidMount);else{if(_&&I.getDerivedStateFromProps==null&&m!==f&&u.componentWillReceiveProps!=null&&u.componentWillReceiveProps(m,C),e.__v==n.__v||!u.__e&&u.shouldComponentUpdate!=null&&u.shouldComponentUpdate(m,u.__s,C)===!1){for(e.__v!=n.__v&&(u.props=m,u.state=u.__s,u.__d=!1),e.__e=n.__e,e.__k=n.__k,e.__k.some(function(F){F&&(F.__=e)}),M=0;M<u._sb.length;M++)u.__h.push(u._sb[M]);u._sb=[],u.__h.length&&l.push(u);break e}u.componentWillUpdate!=null&&u.componentWillUpdate(m,u.__s,C),_&&u.componentDidUpdate!=null&&u.__h.push(function(){u.componentDidUpdate(f,g,k)})}if(u.context=C,u.props=m,u.__P=t,u.__e=!1,R=b.__r,T=0,_){for(u.state=u.__s,u.__d=!1,R&&R(e),d=u.render(u.props,u.state,u.context),D=0;D<u._sb.length;D++)u.__h.push(u._sb[D]);u._sb=[]}else do u.__d=!1,R&&R(e),d=u.render(u.props,u.state,u.context),u.state=u.__s;while(u.__d&&++T<25);u.state=u.__s,u.getChildContext!=null&&(r=j(j({},r),u.getChildContext())),_&&!h&&u.getSnapshotBeforeUpdate!=null&&(k=u.getSnapshotBeforeUpdate(f,g)),P=d,d!=null&&d.type===X&&d.key==null&&(P=ut(d.props.children)),i=st(t,ue(P)?P:[P],e,n,r,o,s,l,i,c,a),u.base=e.__e,e.__u&=-161,u.__h.length&&l.push(u),v&&(u.__E=u.__=null)}catch(F){if(e.__v=null,c||s!=null)if(F.then){for(e.__u|=c?160:128;i&&i.nodeType==8&&i.nextSibling;)i=i.nextSibling;s[s.indexOf(i)]=null,e.__e=i}else{for(G=s.length;G--;)ze(s[G]);Ie(e)}else e.__e=n.__e,e.__k=n.__k,F.then||Ie(e);b.__e(F,e,n)}else s==null&&e.__v==n.__v?(e.__k=n.__k,e.__e=n.__e):i=e.__e=rn(n.__e,e,n,r,o,s,l,c,a);return(d=b.diffed)&&d(e),128&e.__u?void 0:i}function Ie(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Ie)}function dt(t,e,n){for(var r=0;r<n.length;r++)Le(n[r],n[++r],n[++r]);b.__c&&b.__c(e,t),t.some(function(o){try{t=o.__h,o.__h=[],t.some(function(s){s.call(o)})}catch(s){b.__e(s,o.__v)}})}function ut(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:ue(t)?t.map(ut):j({},t)}function rn(t,e,n,r,o,s,l,i,c){var a,d,u,h,f,g,k,v=n.props||ee,m=e.props,_=e.type;if(_=="svg"?o="http://www.w3.org/2000/svg":_=="math"?o="http://www.w3.org/1998/Math/MathML":o||(o="http://www.w3.org/1999/xhtml"),s!=null){for(a=0;a<s.length;a++)if((f=s[a])&&"setAttribute"in f==!!_&&(_?f.localName==_:f.nodeType==3)){t=f,s[a]=null;break}}if(t==null){if(_==null)return document.createTextNode(m);t=document.createElementNS(o,_,m.is&&m),i&&(b.__m&&b.__m(e,s),i=!1),s=null}if(_==null)v===m||i&&t.data==m||(t.data=m);else{if(s=s&&B.call(t.childNodes),!i&&s!=null)for(v={},a=0;a<t.attributes.length;a++)v[(f=t.attributes[a]).name]=f.value;for(a in v)if(f=v[a],a!="children"){if(a=="dangerouslySetInnerHTML")u=f;else if(!(a in m)){if(a=="value"&&"defaultValue"in m||a=="checked"&&"defaultChecked"in m)continue;ge(t,a,null,f,o)}}for(a in m)f=m[a],a=="children"?h=f:a=="dangerouslySetInnerHTML"?d=f:a=="value"?g=f:a=="checked"?k=f:i&&typeof f!="function"||v[a]===f||ge(t,a,f,v[a],o);if(d)i||u&&(d.__html==u.__html||d.__html==t.innerHTML)||(t.innerHTML=d.__html),e.__k=[];else if(u&&(t.innerHTML=""),st(e.type=="template"?t.content:t,ue(h)?h:[h],e,n,r,_=="foreignObject"?"http://www.w3.org/1999/xhtml":o,s,l,s?s[0]:n.__k&&K(n,0),i,c),s!=null)for(a=s.length;a--;)ze(s[a]);i||(a="value",_=="progress"&&g==null?t.removeAttribute("value"):g!=null&&(g!==t[a]||_=="progress"&&!g||_=="option"&&g!=v[a])&&ge(t,a,g,v[a],o),a="checked",k!=null&&k!=t[a]&&ge(t,a,k,v[a],o))}return t}function Le(t,e,n){try{if(typeof t=="function"){var r=typeof t.__u=="function";r&&t.__u(),r&&e==null||(t.__u=t(e))}else t.current=e}catch(o){b.__e(o,n)}}function ct(t,e,n){var r,o;if(b.unmount&&b.unmount(t),(r=t.ref)&&(r.current&&r.current!=t.__e||Le(r,null,e)),(r=t.__c)!=null){if(r.componentWillUnmount)try{r.componentWillUnmount()}catch(s){b.__e(s,e)}r.base=r.__P=null}if(r=t.__k)for(o=0;o<r.length;o++)r[o]&&ct(r[o],e,n||typeof t.type!="function");n||ze(t.__e),t.__c=t.__=t.__e=void 0}function on(t,e,n){return this.constructor(t,n)}function pt(t,e,n){var r,o,s,l;e==document&&(e=document.documentElement),b.__&&b.__(t,e),o=(r=!1)?null:e.__k,s=[],l=[],Te(e,t=e.__k=en(X,null,[t]),o||ee,ee,e.namespaceURI,o?null:e.firstChild?B.call(e.childNodes):null,s,o?o.__e:e.firstChild,r,l),dt(s,t,l)}B=nt.slice,b={__e:function(t,e,n,r){for(var o,s,l;e=e.__;)if((o=e.__c)&&!o.__)try{if((s=o.constructor)&&s.getDerivedStateFromError!=null&&(o.setState(s.getDerivedStateFromError(t)),l=o.__d),o.componentDidCatch!=null&&(o.componentDidCatch(t,r||{}),l=o.__d),l)return o.__E=o}catch(i){t=i}throw t}},Xe=0,pe.prototype.setState=function(t,e){var n;n=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=j({},this.state),typeof t=="function"&&(t=t(j({},n),this.props)),t&&j(n,t),t!=null&&this.__v&&(e&&this._sb.push(e),ot(this))},pe.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),ot(this))},pe.prototype.render=X,Q=[],Je=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,et=function(t,e){return t.__v.__b-e.__v.__b},he.__r=0,tt=/(PointerCapture)$|Capture$/i,$e=0,Ce=lt(!1),Re=lt(!0);var sn=0;function p(t,e,n,r,o,s){e||(e={});var l,i,c=e;if("ref"in c)for(i in c={},e)i=="ref"?l=e[i]:c[i]=e[i];var a={type:t,props:c,key:n,ref:l,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--sn,__i:-1,__u:0,__source:o,__self:s};if(typeof t=="function"&&(l=t.defaultProps))for(i in l)c[i]===void 0&&(c[i]=l[i]);return b.vnode&&b.vnode(a),a}var te,S,Ae,ht,ne=0,gt=[],$=b,ft=$.__b,mt=$.__r,_t=$.diffed,bt=$.__c,xt=$.unmount,kt=$.__;function Ee(t,e){$.__h&&$.__h(S,t,ne||e),ne=0;var n=S.__H||(S.__H={__:[],__h:[]});return t>=n.__.length&&n.__.push({}),n.__[t]}function N(t){return ne=1,an(St,t)}function an(t,e,n){var r=Ee(te++,2);if(r.t=t,!r.__c&&(r.__=[St(void 0,e),function(i){var c=r.__N?r.__N[0]:r.__[0],a=r.t(c,i);c!==a&&(r.__N=[a,r.__[1]],r.__c.setState({}))}],r.__c=S,!S.__f)){var o=function(i,c,a){if(!r.__c.__H)return!0;var d=r.__c.__H.__.filter(function(h){return!!h.__c});if(d.every(function(h){return!h.__N}))return!s||s.call(this,i,c,a);var u=r.__c.props!==i;return d.forEach(function(h){if(h.__N){var f=h.__[0];h.__=h.__N,h.__N=void 0,f!==h.__[0]&&(u=!0)}}),s&&s.call(this,i,c,a)||u};S.__f=!0;var s=S.shouldComponentUpdate,l=S.componentWillUpdate;S.componentWillUpdate=function(i,c,a){if(this.__e){var d=s;s=void 0,o(i,c,a),s=d}l&&l.call(this,i,c,a)},S.shouldComponentUpdate=o}return r.__N||r.__}function re(t,e){var n=Ee(te++,3);!$.__s&&yt(n.__H,e)&&(n.__=t,n.u=e,S.__H.__h.push(n))}function oe(t){return ne=5,vt(function(){return{current:t}},[])}function vt(t,e){var n=Ee(te++,7);return yt(n.__H,e)&&(n.__=t(),n.__H=e,n.__h=t),n.__}function Pe(t,e){return ne=8,vt(function(){return t},e)}function ln(){for(var t;t=gt.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(fe),t.__H.__h.forEach(Be),t.__H.__h=[]}catch(e){t.__H.__h=[],$.__e(e,t.__v)}}$.__b=function(t){S=null,ft&&ft(t)},$.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),kt&&kt(t,e)},$.__r=function(t){mt&&mt(t),te=0;var e=(S=t.__c).__H;e&&(Ae===S?(e.__h=[],S.__h=[],e.__.forEach(function(n){n.__N&&(n.__=n.__N),n.u=n.__N=void 0})):(e.__h.forEach(fe),e.__h.forEach(Be),e.__h=[],te=0)),Ae=S},$.diffed=function(t){_t&&_t(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(gt.push(e)!==1&&ht===$.requestAnimationFrame||((ht=$.requestAnimationFrame)||dn)(ln)),e.__H.__.forEach(function(n){n.u&&(n.__H=n.u),n.u=void 0})),Ae=S=null},$.__c=function(t,e){e.some(function(n){try{n.__h.forEach(fe),n.__h=n.__h.filter(function(r){return!r.__||Be(r)})}catch(r){e.some(function(o){o.__h&&(o.__h=[])}),e=[],$.__e(r,n.__v)}}),bt&&bt(t,e)},$.unmount=function(t){xt&&xt(t);var e,n=t.__c;n&&n.__H&&(n.__H.__.forEach(function(r){try{fe(r)}catch(o){e=o}}),n.__H=void 0,e&&$.__e(e,n.__v))};var wt=typeof requestAnimationFrame=="function";function dn(t){var e,n=function(){clearTimeout(r),wt&&cancelAnimationFrame(e),setTimeout(t)},r=setTimeout(n,35);wt&&(e=requestAnimationFrame(n))}function fe(t){var e=S,n=t.__c;typeof n=="function"&&(t.__c=void 0,n()),S=e}function Be(t){var e=S;t.__c=t.__(),S=e}function yt(t,e){return!t||t.length!==e.length||e.some(function(n,r){return n!==t[r]})}function St(t,e){return typeof e=="function"?e(t):e}function un({token:t,apiBase:e}){const[n,r]=N([]),[o,s]=N(!1),[l,i]=N(!1),[c,a]=N(null),[d,u]=N({status:"idle"}),h=oe(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),f=oe(null),g=()=>Math.random().toString(36).slice(2,11),k=Pe(async _=>{var M;if(!_.trim()||o||l)return;const A={id:g(),role:"user",content:_.trim(),timestamp:Date.now()},C=g();r(R=>[...R,A]),s(!0),i(!0),a(null),u({status:"searching",message:"Searching knowledge base..."}),f.current=new AbortController;try{const R={message:_.trim()};h.current&&(R.conversationId=h.current);const T=await fetch(`${e}/api/v1/widget/${t}/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(R),signal:f.current.signal});if(!T.ok){const O=await T.json().catch(()=>({}));throw new Error(O.message||`Request failed: ${T.status}`)}r(O=>[...O,{id:C,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),s(!1);const D=(M=T.body)==null?void 0:M.getReader();if(!D)throw new Error("No response body");const P=new TextDecoder;let G="",I="",F=[];for(;;){const{done:O,value:Z}=await D.read();if(O)break;G+=P.decode(Z,{stream:!0});const ye=G.split(`
`);G=ye.pop()||"";for(const de of ye)if(de.startsWith("data: "))try{const z=JSON.parse(de.slice(6));if(z.type==="status")u({status:z.status||"searching",message:z.message,sourcesCount:z.sourcesCount}),z.status==="generating"&&u({status:"generating",message:z.message,sourcesCount:z.sourcesCount});else if(z.type==="text"&&z.content)I||u({status:"streaming"}),I+=z.content,r(Qe=>Qe.map(J=>J.id===C?{...J,content:I}:J));else if(z.type==="done"){if(z.conversationId){h.current=z.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,z.conversationId)}catch{}}F=z.citations||[],u({status:"idle"})}else if(z.type==="error")throw new Error(z.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",de)}}r(O=>O.map(Z=>Z.id===C?{...Z,content:I,isStreaming:!1,citations:F}:Z))}catch(R){if(R.name==="AbortError"){u({status:"idle"});return}u({status:"idle"}),a(R instanceof Error?R.message:"An error occurred"),r(T=>T.some(P=>P.id===C)?T.map(P=>P.id===C?{...P,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:P):[...T,{id:C,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{s(!1),i(!1),f.current=null}},[t,e,o,l]),v=Pe(()=>{f.current&&(f.current.abort(),f.current=null),i(!1),s(!1)},[]),m=Pe(()=>{r([]),h.current=null;try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:n,isLoading:o,isStreaming:l,error:c,chatStatus:d,sendMessage:k,stopStreaming:v,clearMessages:m}}function cn({token:t,apiBase:e}){const[n,r]=N(null),[o,s]=N(!0),[l,i]=N(null);return re(()=>{async function c(){try{const a=await fetch(`${e}/api/v1/widget/${t}/config`);if(!a.ok)throw new Error("Failed to load widget configuration");const d=await a.json();r(d)}catch(a){i(a instanceof Error?a.message:"Configuration error"),r({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0})}finally{s(!1)}}c()},[t,e]),{config:n,isLoading:o,error:l}}function Ne(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var V=Ne();function $t(t){V=t}var se={exec:()=>null};function w(t,e=""){let n=typeof t=="string"?t:t.source;const r={replace:(o,s)=>{let l=typeof s=="string"?s:s.source;return l=l.replace(E.caret,"$1"),n=n.replace(o,l),r},getRegex:()=>new RegExp(n,e)};return r}var E={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] /,listReplaceTask:/^\[[ xX]\] +/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},pn=/^(?:[ \t]*(?:\n|$))+/,hn=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,gn=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,ie=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,fn=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Me=/(?:[*+-]|\d{1,9}[.)])/,Ct=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,Rt=w(Ct).replace(/bull/g,Me).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),mn=w(Ct).replace(/bull/g,Me).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Fe=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,_n=/^[^\n]+/,qe=/(?!\s*\])(?:\\.|[^\[\]\\])+/,bn=w(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",qe).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),xn=w(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Me).getRegex(),me="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",He=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,kn=w("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",He).replace("tag",me).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),zt=w(Fe).replace("hr",ie).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",me).getRegex(),vn=w(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",zt).getRegex(),De={blockquote:vn,code:hn,def:bn,fences:gn,heading:fn,hr:ie,html:kn,lheading:Rt,list:xn,newline:pn,paragraph:zt,table:se,text:_n},Tt=w("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",ie).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",me).getRegex(),wn={...De,lheading:mn,table:Tt,paragraph:w(Fe).replace("hr",ie).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Tt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",me).getRegex()},yn={...De,html:w(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",He).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:se,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:w(Fe).replace("hr",ie).replace("heading",` *#{1,6} *[^
]`).replace("lheading",Rt).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},Sn=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,$n=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,It=/^( {2,}|\\)\n(?!\s*$)/,Cn=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,_e=/[\p{P}\p{S}]/u,je=/[\s\p{P}\p{S}]/u,Lt=/[^\s\p{P}\p{S}]/u,Rn=w(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,je).getRegex(),At=/(?!~)[\p{P}\p{S}]/u,zn=/(?!~)[\s\p{P}\p{S}]/u,Tn=/(?:[^\s\p{P}\p{S}]|~)/u,In=/\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g,Et=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,Ln=w(Et,"u").replace(/punct/g,_e).getRegex(),An=w(Et,"u").replace(/punct/g,At).getRegex(),Pt="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",En=w(Pt,"gu").replace(/notPunctSpace/g,Lt).replace(/punctSpace/g,je).replace(/punct/g,_e).getRegex(),Pn=w(Pt,"gu").replace(/notPunctSpace/g,Tn).replace(/punctSpace/g,zn).replace(/punct/g,At).getRegex(),Bn=w("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Lt).replace(/punctSpace/g,je).replace(/punct/g,_e).getRegex(),Nn=w(/\\(punct)/,"gu").replace(/punct/g,_e).getRegex(),Mn=w(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Fn=w(He).replace("(?:-->|$)","-->").getRegex(),qn=w("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Fn).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),be=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/,Hn=w(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",be).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Bt=w(/^!?\[(label)\]\[(ref)\]/).replace("label",be).replace("ref",qe).getRegex(),Nt=w(/^!?\[(ref)\](?:\[\])?/).replace("ref",qe).getRegex(),Dn=w("reflink|nolink(?!\\()","g").replace("reflink",Bt).replace("nolink",Nt).getRegex(),We={_backpedal:se,anyPunctuation:Nn,autolink:Mn,blockSkip:In,br:It,code:$n,del:se,emStrongLDelim:Ln,emStrongRDelimAst:En,emStrongRDelimUnd:Bn,escape:Sn,link:Hn,nolink:Nt,punctuation:Rn,reflink:Bt,reflinkSearch:Dn,tag:qn,text:Cn,url:se},jn={...We,link:w(/^!?\[(label)\]\((.*?)\)/).replace("label",be).getRegex(),reflink:w(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",be).getRegex()},Ue={...We,emStrongRDelimAst:Pn,emStrongLDelim:An,url:w(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,"i").replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/},Wn={...Ue,br:w(It).replace("{2,}","*").getRegex(),text:w(Ue.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},xe={normal:De,gfm:wn,pedantic:yn},ae={normal:We,gfm:Ue,breaks:Wn,pedantic:jn},Un={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Mt=t=>Un[t];function H(t,e){if(e){if(E.escapeTest.test(t))return t.replace(E.escapeReplace,Mt)}else if(E.escapeTestNoEncode.test(t))return t.replace(E.escapeReplaceNoEncode,Mt);return t}function Ft(t){try{t=encodeURI(t).replace(E.percentDecode,"%")}catch{return null}return t}function qt(t,e){var s;const n=t.replace(E.findPipe,(l,i,c)=>{let a=!1,d=i;for(;--d>=0&&c[d]==="\\";)a=!a;return a?"|":" |"}),r=n.split(E.splitPipe);let o=0;if(r[0].trim()||r.shift(),r.length>0&&!((s=r.at(-1))!=null&&s.trim())&&r.pop(),e)if(r.length>e)r.splice(e);else for(;r.length<e;)r.push("");for(;o<r.length;o++)r[o]=r[o].trim().replace(E.slashPipe,"|");return r}function le(t,e,n){const r=t.length;if(r===0)return"";let o=0;for(;o<r&&t.charAt(r-o-1)===e;)o++;return t.slice(0,r-o)}function Gn(t,e){if(t.indexOf(e[1])===-1)return-1;let n=0;for(let r=0;r<t.length;r++)if(t[r]==="\\")r++;else if(t[r]===e[0])n++;else if(t[r]===e[1]&&(n--,n<0))return r;return n>0?-2:-1}function Ht(t,e,n,r,o){const s=e.href,l=e.title||null,i=t[1].replace(o.other.outputLinkReplace,"$1");r.state.inLink=!0;const c={type:t[0].charAt(0)==="!"?"image":"link",raw:n,href:s,title:l,text:i,tokens:r.inlineTokens(i)};return r.state.inLink=!1,c}function On(t,e,n){const r=t.match(n.other.indentCodeCompensation);if(r===null)return e;const o=r[1];return e.split(`
`).map(s=>{const l=s.match(n.other.beginningSpace);if(l===null)return s;const[i]=l;return i.length>=o.length?s.slice(o.length):s}).join(`
`)}var ke=class{constructor(t){y(this,"options");y(this,"rules");y(this,"lexer");this.options=t||V}space(t){const e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){const e=this.rules.block.code.exec(t);if(e){const n=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?n:le(n,`
`)}}}fences(t){const e=this.rules.block.fences.exec(t);if(e){const n=e[0],r=On(n,e[3]||"",this.rules);return{type:"code",raw:n,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:r}}}heading(t){const e=this.rules.block.heading.exec(t);if(e){let n=e[2].trim();if(this.rules.other.endingHash.test(n)){const r=le(n,"#");(this.options.pedantic||!r||this.rules.other.endingSpaceChar.test(r))&&(n=r.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(t){const e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:le(e[0],`
`)}}blockquote(t){const e=this.rules.block.blockquote.exec(t);if(e){let n=le(e[0],`
`).split(`
`),r="",o="";const s=[];for(;n.length>0;){let l=!1;const i=[];let c;for(c=0;c<n.length;c++)if(this.rules.other.blockquoteStart.test(n[c]))i.push(n[c]),l=!0;else if(!l)i.push(n[c]);else break;n=n.slice(c);const a=i.join(`
`),d=a.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");r=r?`${r}
${a}`:a,o=o?`${o}
${d}`:d;const u=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(d,s,!0),this.lexer.state.top=u,n.length===0)break;const h=s.at(-1);if((h==null?void 0:h.type)==="code")break;if((h==null?void 0:h.type)==="blockquote"){const f=h,g=f.raw+`
`+n.join(`
`),k=this.blockquote(g);s[s.length-1]=k,r=r.substring(0,r.length-f.raw.length)+k.raw,o=o.substring(0,o.length-f.text.length)+k.text;break}else if((h==null?void 0:h.type)==="list"){const f=h,g=f.raw+`
`+n.join(`
`),k=this.list(g);s[s.length-1]=k,r=r.substring(0,r.length-h.raw.length)+k.raw,o=o.substring(0,o.length-f.raw.length)+k.raw,n=g.substring(s.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:r,tokens:s,text:o}}}list(t){let e=this.rules.block.list.exec(t);if(e){let n=e[1].trim();const r=n.length>1,o={type:"list",raw:"",ordered:r,start:r?+n.slice(0,-1):"",loose:!1,items:[]};n=r?`\\d{1,9}\\${n.slice(-1)}`:`\\${n}`,this.options.pedantic&&(n=r?n:"[*+-]");const s=this.rules.other.listItemRegex(n);let l=!1;for(;t;){let c=!1,a="",d="";if(!(e=s.exec(t))||this.rules.block.hr.test(t))break;a=e[0],t=t.substring(a.length);let u=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,m=>" ".repeat(3*m.length)),h=t.split(`
`,1)[0],f=!u.trim(),g=0;if(this.options.pedantic?(g=2,d=u.trimStart()):f?g=e[1].length+1:(g=e[2].search(this.rules.other.nonSpaceChar),g=g>4?1:g,d=u.slice(g),g+=e[1].length),f&&this.rules.other.blankLine.test(h)&&(a+=h+`
`,t=t.substring(h.length+1),c=!0),!c){const m=this.rules.other.nextBulletRegex(g),_=this.rules.other.hrRegex(g),A=this.rules.other.fencesBeginRegex(g),C=this.rules.other.headingBeginRegex(g),M=this.rules.other.htmlBeginRegex(g);for(;t;){const R=t.split(`
`,1)[0];let T;if(h=R,this.options.pedantic?(h=h.replace(this.rules.other.listReplaceNesting,"  "),T=h):T=h.replace(this.rules.other.tabCharGlobal,"    "),A.test(h)||C.test(h)||M.test(h)||m.test(h)||_.test(h))break;if(T.search(this.rules.other.nonSpaceChar)>=g||!h.trim())d+=`
`+T.slice(g);else{if(f||u.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||A.test(u)||C.test(u)||_.test(u))break;d+=`
`+h}!f&&!h.trim()&&(f=!0),a+=R+`
`,t=t.substring(R.length+1),u=T.slice(g)}}o.loose||(l?o.loose=!0:this.rules.other.doubleBlankLine.test(a)&&(l=!0));let k=null,v;this.options.gfm&&(k=this.rules.other.listIsTask.exec(d),k&&(v=k[0]!=="[ ] ",d=d.replace(this.rules.other.listReplaceTask,""))),o.items.push({type:"list_item",raw:a,task:!!k,checked:v,loose:!1,text:d,tokens:[]}),o.raw+=a}const i=o.items.at(-1);if(i)i.raw=i.raw.trimEnd(),i.text=i.text.trimEnd();else return;o.raw=o.raw.trimEnd();for(let c=0;c<o.items.length;c++)if(this.lexer.state.top=!1,o.items[c].tokens=this.lexer.blockTokens(o.items[c].text,[]),!o.loose){const a=o.items[c].tokens.filter(u=>u.type==="space"),d=a.length>0&&a.some(u=>this.rules.other.anyLine.test(u.raw));o.loose=d}if(o.loose)for(let c=0;c<o.items.length;c++)o.items[c].loose=!0;return o}}html(t){const e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){const e=this.rules.block.def.exec(t);if(e){const n=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),r=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",o=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:n,raw:e[0],href:r,title:o}}}table(t){var l;const e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;const n=qt(e[1]),r=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),o=(l=e[3])!=null&&l.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],s={type:"table",raw:e[0],header:[],align:[],rows:[]};if(n.length===r.length){for(const i of r)this.rules.other.tableAlignRight.test(i)?s.align.push("right"):this.rules.other.tableAlignCenter.test(i)?s.align.push("center"):this.rules.other.tableAlignLeft.test(i)?s.align.push("left"):s.align.push(null);for(let i=0;i<n.length;i++)s.header.push({text:n[i],tokens:this.lexer.inline(n[i]),header:!0,align:s.align[i]});for(const i of o)s.rows.push(qt(i,s.header.length).map((c,a)=>({text:c,tokens:this.lexer.inline(c),header:!1,align:s.align[a]})));return s}}lheading(t){const e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){const e=this.rules.block.paragraph.exec(t);if(e){const n=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:n,tokens:this.lexer.inline(n)}}}text(t){const e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){const e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){const e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){const e=this.rules.inline.link.exec(t);if(e){const n=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;const s=le(n.slice(0,-1),"\\");if((n.length-s.length)%2===0)return}else{const s=Gn(e[2],"()");if(s===-2)return;if(s>-1){const i=(e[0].indexOf("!")===0?5:4)+e[1].length+s;e[2]=e[2].substring(0,s),e[0]=e[0].substring(0,i).trim(),e[3]=""}}let r=e[2],o="";if(this.options.pedantic){const s=this.rules.other.pedanticHrefTitle.exec(r);s&&(r=s[1],o=s[3])}else o=e[3]?e[3].slice(1,-1):"";return r=r.trim(),this.rules.other.startAngleBracket.test(r)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?r=r.slice(1):r=r.slice(1,-1)),Ht(e,{href:r&&r.replace(this.rules.inline.anyPunctuation,"$1"),title:o&&o.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let n;if((n=this.rules.inline.reflink.exec(t))||(n=this.rules.inline.nolink.exec(t))){const r=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),o=e[r.toLowerCase()];if(!o){const s=n[0].charAt(0);return{type:"text",raw:s,text:s}}return Ht(n,o,n[0],this.lexer,this.rules)}}emStrong(t,e,n=""){let r=this.rules.inline.emStrongLDelim.exec(t);if(!r||r[3]&&n.match(this.rules.other.unicodeAlphaNumeric))return;if(!(r[1]||r[2]||"")||!n||this.rules.inline.punctuation.exec(n)){const s=[...r[0]].length-1;let l,i,c=s,a=0;const d=r[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(d.lastIndex=0,e=e.slice(-1*t.length+s);(r=d.exec(e))!=null;){if(l=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!l)continue;if(i=[...l].length,r[3]||r[4]){c+=i;continue}else if((r[5]||r[6])&&s%3&&!((s+i)%3)){a+=i;continue}if(c-=i,c>0)continue;i=Math.min(i,i+c+a);const u=[...r[0]][0].length,h=t.slice(0,s+r.index+u+i);if(Math.min(s,i)%2){const g=h.slice(1,-1);return{type:"em",raw:h,text:g,tokens:this.lexer.inlineTokens(g)}}const f=h.slice(2,-2);return{type:"strong",raw:h,text:f,tokens:this.lexer.inlineTokens(f)}}}}codespan(t){const e=this.rules.inline.code.exec(t);if(e){let n=e[2].replace(this.rules.other.newLineCharGlobal," ");const r=this.rules.other.nonSpaceChar.test(n),o=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return r&&o&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:e[0],text:n}}}br(t){const e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){const e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){const e=this.rules.inline.autolink.exec(t);if(e){let n,r;return e[2]==="@"?(n=e[1],r="mailto:"+n):(n=e[1],r=n),{type:"link",raw:e[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}url(t){var n;let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let s;do s=e[0],e[0]=((n=this.rules.inline._backpedal.exec(e[0]))==null?void 0:n[0])??"";while(s!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){const e=this.rules.inline.text.exec(t);if(e){const n=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:n}}}},W=class Ve{constructor(e){y(this,"tokens");y(this,"options");y(this,"state");y(this,"tokenizer");y(this,"inlineQueue");this.tokens=[],this.tokens.links=Object.create(null),this.options=e||V,this.options.tokenizer=this.options.tokenizer||new ke,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};const n={other:E,block:xe.normal,inline:ae.normal};this.options.pedantic?(n.block=xe.pedantic,n.inline=ae.pedantic):this.options.gfm&&(n.block=xe.gfm,this.options.breaks?n.inline=ae.breaks:n.inline=ae.gfm),this.tokenizer.rules=n}static get rules(){return{block:xe,inline:ae}}static lex(e,n){return new Ve(n).lex(e)}static lexInline(e,n){return new Ve(n).inlineTokens(e)}lex(e){e=e.replace(E.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let n=0;n<this.inlineQueue.length;n++){const r=this.inlineQueue[n];this.inlineTokens(r.src,r.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,n=[],r=!1){var o,s,l;for(this.options.pedantic&&(e=e.replace(E.tabCharGlobal,"    ").replace(E.spaceLine,""));e;){let i;if((s=(o=this.options.extensions)==null?void 0:o.block)!=null&&s.some(a=>(i=a.call({lexer:this},e,n))?(e=e.substring(i.raw.length),n.push(i),!0):!1))continue;if(i=this.tokenizer.space(e)){e=e.substring(i.raw.length);const a=n.at(-1);i.raw.length===1&&a!==void 0?a.raw+=`
`:n.push(i);continue}if(i=this.tokenizer.code(e)){e=e.substring(i.raw.length);const a=n.at(-1);(a==null?void 0:a.type)==="paragraph"||(a==null?void 0:a.type)==="text"?(a.raw+=`
`+i.raw,a.text+=`
`+i.text,this.inlineQueue.at(-1).src=a.text):n.push(i);continue}if(i=this.tokenizer.fences(e)){e=e.substring(i.raw.length),n.push(i);continue}if(i=this.tokenizer.heading(e)){e=e.substring(i.raw.length),n.push(i);continue}if(i=this.tokenizer.hr(e)){e=e.substring(i.raw.length),n.push(i);continue}if(i=this.tokenizer.blockquote(e)){e=e.substring(i.raw.length),n.push(i);continue}if(i=this.tokenizer.list(e)){e=e.substring(i.raw.length),n.push(i);continue}if(i=this.tokenizer.html(e)){e=e.substring(i.raw.length),n.push(i);continue}if(i=this.tokenizer.def(e)){e=e.substring(i.raw.length);const a=n.at(-1);(a==null?void 0:a.type)==="paragraph"||(a==null?void 0:a.type)==="text"?(a.raw+=`
`+i.raw,a.text+=`
`+i.raw,this.inlineQueue.at(-1).src=a.text):this.tokens.links[i.tag]||(this.tokens.links[i.tag]={href:i.href,title:i.title});continue}if(i=this.tokenizer.table(e)){e=e.substring(i.raw.length),n.push(i);continue}if(i=this.tokenizer.lheading(e)){e=e.substring(i.raw.length),n.push(i);continue}let c=e;if((l=this.options.extensions)!=null&&l.startBlock){let a=1/0;const d=e.slice(1);let u;this.options.extensions.startBlock.forEach(h=>{u=h.call({lexer:this},d),typeof u=="number"&&u>=0&&(a=Math.min(a,u))}),a<1/0&&a>=0&&(c=e.substring(0,a+1))}if(this.state.top&&(i=this.tokenizer.paragraph(c))){const a=n.at(-1);r&&(a==null?void 0:a.type)==="paragraph"?(a.raw+=`
`+i.raw,a.text+=`
`+i.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=a.text):n.push(i),r=c.length!==e.length,e=e.substring(i.raw.length);continue}if(i=this.tokenizer.text(e)){e=e.substring(i.raw.length);const a=n.at(-1);(a==null?void 0:a.type)==="text"?(a.raw+=`
`+i.raw,a.text+=`
`+i.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=a.text):n.push(i);continue}if(e){const a="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(a);break}else throw new Error(a)}}return this.state.top=!0,n}inline(e,n=[]){return this.inlineQueue.push({src:e,tokens:n}),n}inlineTokens(e,n=[]){var i,c,a;let r=e,o=null;if(this.tokens.links){const d=Object.keys(this.tokens.links);if(d.length>0)for(;(o=this.tokenizer.rules.inline.reflinkSearch.exec(r))!=null;)d.includes(o[0].slice(o[0].lastIndexOf("[")+1,-1))&&(r=r.slice(0,o.index)+"["+"a".repeat(o[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(o=this.tokenizer.rules.inline.anyPunctuation.exec(r))!=null;)r=r.slice(0,o.index)+"++"+r.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;(o=this.tokenizer.rules.inline.blockSkip.exec(r))!=null;)r=r.slice(0,o.index)+"["+"a".repeat(o[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);let s=!1,l="";for(;e;){s||(l=""),s=!1;let d;if((c=(i=this.options.extensions)==null?void 0:i.inline)!=null&&c.some(h=>(d=h.call({lexer:this},e,n))?(e=e.substring(d.raw.length),n.push(d),!0):!1))continue;if(d=this.tokenizer.escape(e)){e=e.substring(d.raw.length),n.push(d);continue}if(d=this.tokenizer.tag(e)){e=e.substring(d.raw.length),n.push(d);continue}if(d=this.tokenizer.link(e)){e=e.substring(d.raw.length),n.push(d);continue}if(d=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(d.raw.length);const h=n.at(-1);d.type==="text"&&(h==null?void 0:h.type)==="text"?(h.raw+=d.raw,h.text+=d.text):n.push(d);continue}if(d=this.tokenizer.emStrong(e,r,l)){e=e.substring(d.raw.length),n.push(d);continue}if(d=this.tokenizer.codespan(e)){e=e.substring(d.raw.length),n.push(d);continue}if(d=this.tokenizer.br(e)){e=e.substring(d.raw.length),n.push(d);continue}if(d=this.tokenizer.del(e)){e=e.substring(d.raw.length),n.push(d);continue}if(d=this.tokenizer.autolink(e)){e=e.substring(d.raw.length),n.push(d);continue}if(!this.state.inLink&&(d=this.tokenizer.url(e))){e=e.substring(d.raw.length),n.push(d);continue}let u=e;if((a=this.options.extensions)!=null&&a.startInline){let h=1/0;const f=e.slice(1);let g;this.options.extensions.startInline.forEach(k=>{g=k.call({lexer:this},f),typeof g=="number"&&g>=0&&(h=Math.min(h,g))}),h<1/0&&h>=0&&(u=e.substring(0,h+1))}if(d=this.tokenizer.inlineText(u)){e=e.substring(d.raw.length),d.raw.slice(-1)!=="_"&&(l=d.raw.slice(-1)),s=!0;const h=n.at(-1);(h==null?void 0:h.type)==="text"?(h.raw+=d.raw,h.text+=d.text):n.push(d);continue}if(e){const h="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(h);break}else throw new Error(h)}}return n}},ve=class{constructor(t){y(this,"options");y(this,"parser");this.options=t||V}space(t){return""}code({text:t,lang:e,escaped:n}){var s;const r=(s=(e||"").match(E.notSpaceStart))==null?void 0:s[0],o=t.replace(E.endingNewline,"")+`
`;return r?'<pre><code class="language-'+H(r)+'">'+(n?o:H(o,!0))+`</code></pre>
`:"<pre><code>"+(n?o:H(o,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){const e=t.ordered,n=t.start;let r="";for(let l=0;l<t.items.length;l++){const i=t.items[l];r+=this.listitem(i)}const o=e?"ol":"ul",s=e&&n!==1?' start="'+n+'"':"";return"<"+o+s+`>
`+r+"</"+o+`>
`}listitem(t){var n;let e="";if(t.task){const r=this.checkbox({checked:!!t.checked});t.loose?((n=t.tokens[0])==null?void 0:n.type)==="paragraph"?(t.tokens[0].text=r+" "+t.tokens[0].text,t.tokens[0].tokens&&t.tokens[0].tokens.length>0&&t.tokens[0].tokens[0].type==="text"&&(t.tokens[0].tokens[0].text=r+" "+H(t.tokens[0].tokens[0].text),t.tokens[0].tokens[0].escaped=!0)):t.tokens.unshift({type:"text",raw:r+" ",text:r+" ",escaped:!0}):e+=r+" "}return e+=this.parser.parse(t.tokens,!!t.loose),`<li>${e}</li>
`}checkbox({checked:t}){return"<input "+(t?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph({tokens:t}){return`<p>${this.parser.parseInline(t)}</p>
`}table(t){let e="",n="";for(let o=0;o<t.header.length;o++)n+=this.tablecell(t.header[o]);e+=this.tablerow({text:n});let r="";for(let o=0;o<t.rows.length;o++){const s=t.rows[o];n="";for(let l=0;l<s.length;l++)n+=this.tablecell(s[l]);r+=this.tablerow({text:n})}return r&&(r=`<tbody>${r}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+r+`</table>
`}tablerow({text:t}){return`<tr>
${t}</tr>
`}tablecell(t){const e=this.parser.parseInline(t.tokens),n=t.header?"th":"td";return(t.align?`<${n} align="${t.align}">`:`<${n}>`)+e+`</${n}>
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${H(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:n}){const r=this.parser.parseInline(n),o=Ft(t);if(o===null)return r;t=o;let s='<a href="'+t+'"';return e&&(s+=' title="'+H(e)+'"'),s+=">"+r+"</a>",s}image({href:t,title:e,text:n,tokens:r}){r&&(n=this.parser.parseInline(r,this.parser.textRenderer));const o=Ft(t);if(o===null)return H(n);t=o;let s=`<img src="${t}" alt="${n}"`;return e&&(s+=` title="${H(e)}"`),s+=">",s}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:H(t.text)}},Ge=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}},U=class Ye{constructor(e){y(this,"options");y(this,"renderer");y(this,"textRenderer");this.options=e||V,this.options.renderer=this.options.renderer||new ve,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new Ge}static parse(e,n){return new Ye(n).parse(e)}static parseInline(e,n){return new Ye(n).parseInline(e)}parse(e,n=!0){var o,s;let r="";for(let l=0;l<e.length;l++){const i=e[l];if((s=(o=this.options.extensions)==null?void 0:o.renderers)!=null&&s[i.type]){const a=i,d=this.options.extensions.renderers[a.type].call({parser:this},a);if(d!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(a.type)){r+=d||"";continue}}const c=i;switch(c.type){case"space":{r+=this.renderer.space(c);continue}case"hr":{r+=this.renderer.hr(c);continue}case"heading":{r+=this.renderer.heading(c);continue}case"code":{r+=this.renderer.code(c);continue}case"table":{r+=this.renderer.table(c);continue}case"blockquote":{r+=this.renderer.blockquote(c);continue}case"list":{r+=this.renderer.list(c);continue}case"html":{r+=this.renderer.html(c);continue}case"paragraph":{r+=this.renderer.paragraph(c);continue}case"text":{let a=c,d=this.renderer.text(a);for(;l+1<e.length&&e[l+1].type==="text";)a=e[++l],d+=`
`+this.renderer.text(a);n?r+=this.renderer.paragraph({type:"paragraph",raw:d,text:d,tokens:[{type:"text",raw:d,text:d,escaped:!0}]}):r+=d;continue}default:{const a='Token with "'+c.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return r}parseInline(e,n=this.renderer){var o,s;let r="";for(let l=0;l<e.length;l++){const i=e[l];if((s=(o=this.options.extensions)==null?void 0:o.renderers)!=null&&s[i.type]){const a=this.options.extensions.renderers[i.type].call({parser:this},i);if(a!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(i.type)){r+=a||"";continue}}const c=i;switch(c.type){case"escape":{r+=n.text(c);break}case"html":{r+=n.html(c);break}case"link":{r+=n.link(c);break}case"image":{r+=n.image(c);break}case"strong":{r+=n.strong(c);break}case"em":{r+=n.em(c);break}case"codespan":{r+=n.codespan(c);break}case"br":{r+=n.br(c);break}case"del":{r+=n.del(c);break}case"text":{r+=n.text(c);break}default:{const a='Token with "'+c.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return r}},we=(Ze=class{constructor(t){y(this,"options");y(this,"block");this.options=t||V}preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}provideLexer(){return this.block?W.lex:W.lexInline}provideParser(){return this.block?U.parse:U.parseInline}},y(Ze,"passThroughHooks",new Set(["preprocess","postprocess","processAllTokens"])),Ze),Zn=class{constructor(...t){y(this,"defaults",Ne());y(this,"options",this.setOptions);y(this,"parse",this.parseMarkdown(!0));y(this,"parseInline",this.parseMarkdown(!1));y(this,"Parser",U);y(this,"Renderer",ve);y(this,"TextRenderer",Ge);y(this,"Lexer",W);y(this,"Tokenizer",ke);y(this,"Hooks",we);this.use(...t)}walkTokens(t,e){var r,o;let n=[];for(const s of t)switch(n=n.concat(e.call(this,s)),s.type){case"table":{const l=s;for(const i of l.header)n=n.concat(this.walkTokens(i.tokens,e));for(const i of l.rows)for(const c of i)n=n.concat(this.walkTokens(c.tokens,e));break}case"list":{const l=s;n=n.concat(this.walkTokens(l.items,e));break}default:{const l=s;(o=(r=this.defaults.extensions)==null?void 0:r.childTokens)!=null&&o[l.type]?this.defaults.extensions.childTokens[l.type].forEach(i=>{const c=l[i].flat(1/0);n=n.concat(this.walkTokens(c,e))}):l.tokens&&(n=n.concat(this.walkTokens(l.tokens,e)))}}return n}use(...t){const e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(n=>{const r={...n};if(r.async=this.defaults.async||r.async||!1,n.extensions&&(n.extensions.forEach(o=>{if(!o.name)throw new Error("extension name required");if("renderer"in o){const s=e.renderers[o.name];s?e.renderers[o.name]=function(...l){let i=o.renderer.apply(this,l);return i===!1&&(i=s.apply(this,l)),i}:e.renderers[o.name]=o.renderer}if("tokenizer"in o){if(!o.level||o.level!=="block"&&o.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");const s=e[o.level];s?s.unshift(o.tokenizer):e[o.level]=[o.tokenizer],o.start&&(o.level==="block"?e.startBlock?e.startBlock.push(o.start):e.startBlock=[o.start]:o.level==="inline"&&(e.startInline?e.startInline.push(o.start):e.startInline=[o.start]))}"childTokens"in o&&o.childTokens&&(e.childTokens[o.name]=o.childTokens)}),r.extensions=e),n.renderer){const o=this.defaults.renderer||new ve(this.defaults);for(const s in n.renderer){if(!(s in o))throw new Error(`renderer '${s}' does not exist`);if(["options","parser"].includes(s))continue;const l=s,i=n.renderer[l],c=o[l];o[l]=(...a)=>{let d=i.apply(o,a);return d===!1&&(d=c.apply(o,a)),d||""}}r.renderer=o}if(n.tokenizer){const o=this.defaults.tokenizer||new ke(this.defaults);for(const s in n.tokenizer){if(!(s in o))throw new Error(`tokenizer '${s}' does not exist`);if(["options","rules","lexer"].includes(s))continue;const l=s,i=n.tokenizer[l],c=o[l];o[l]=(...a)=>{let d=i.apply(o,a);return d===!1&&(d=c.apply(o,a)),d}}r.tokenizer=o}if(n.hooks){const o=this.defaults.hooks||new we;for(const s in n.hooks){if(!(s in o))throw new Error(`hook '${s}' does not exist`);if(["options","block"].includes(s))continue;const l=s,i=n.hooks[l],c=o[l];we.passThroughHooks.has(s)?o[l]=a=>{if(this.defaults.async)return Promise.resolve(i.call(o,a)).then(u=>c.call(o,u));const d=i.call(o,a);return c.call(o,d)}:o[l]=(...a)=>{let d=i.apply(o,a);return d===!1&&(d=c.apply(o,a)),d}}r.hooks=o}if(n.walkTokens){const o=this.defaults.walkTokens,s=n.walkTokens;r.walkTokens=function(l){let i=[];return i.push(s.call(this,l)),o&&(i=i.concat(o.call(this,l))),i}}this.defaults={...this.defaults,...r}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return W.lex(t,e??this.defaults)}parser(t,e){return U.parse(t,e??this.defaults)}parseMarkdown(t){return(n,r)=>{const o={...r},s={...this.defaults,...o},l=this.onError(!!s.silent,!!s.async);if(this.defaults.async===!0&&o.async===!1)return l(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof n>"u"||n===null)return l(new Error("marked(): input parameter is undefined or null"));if(typeof n!="string")return l(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(n)+", string expected"));s.hooks&&(s.hooks.options=s,s.hooks.block=t);const i=s.hooks?s.hooks.provideLexer():t?W.lex:W.lexInline,c=s.hooks?s.hooks.provideParser():t?U.parse:U.parseInline;if(s.async)return Promise.resolve(s.hooks?s.hooks.preprocess(n):n).then(a=>i(a,s)).then(a=>s.hooks?s.hooks.processAllTokens(a):a).then(a=>s.walkTokens?Promise.all(this.walkTokens(a,s.walkTokens)).then(()=>a):a).then(a=>c(a,s)).then(a=>s.hooks?s.hooks.postprocess(a):a).catch(l);try{s.hooks&&(n=s.hooks.preprocess(n));let a=i(n,s);s.hooks&&(a=s.hooks.processAllTokens(a)),s.walkTokens&&this.walkTokens(a,s.walkTokens);let d=c(a,s);return s.hooks&&(d=s.hooks.postprocess(d)),d}catch(a){return l(a)}}}onError(t,e){return n=>{if(n.message+=`
Please report this to https://github.com/markedjs/marked.`,t){const r="<p>An error occurred:</p><pre>"+H(n.message+"",!0)+"</pre>";return e?Promise.resolve(r):r}if(e)return Promise.reject(n);throw n}}},Y=new Zn;function x(t,e){return Y.parse(t,e)}x.options=x.setOptions=function(t){return Y.setOptions(t),x.defaults=Y.defaults,$t(x.defaults),x},x.getDefaults=Ne,x.defaults=V,x.use=function(...t){return Y.use(...t),x.defaults=Y.defaults,$t(x.defaults),x},x.walkTokens=function(t,e){return Y.walkTokens(t,e)},x.parseInline=Y.parseInline,x.Parser=U,x.parser=U.parse,x.Renderer=ve,x.TextRenderer=Ge,x.Lexer=W,x.lexer=W.lex,x.Tokenizer=ke,x.Hooks=we,x.parse=x,x.options,x.setOptions,x.use,x.walkTokens,x.parseInline,U.parse,W.lex;function Qn({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:p("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function Dt({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),p("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function Vn({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("path",{d:"m5 12 7-7 7 7"}),p("path",{d:"M12 19V5"})]})}function Yn({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:p("path",{d:"m6 9 6 6 6-6"})})}function jt({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:p("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function Wt({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),p("path",{d:"M5 3v4"}),p("path",{d:"M19 17v4"}),p("path",{d:"M3 5h4"}),p("path",{d:"M17 19h4"})]})}function Xn({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("polyline",{points:"15 3 21 3 21 9"}),p("polyline",{points:"9 21 3 21 3 15"}),p("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),p("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Kn({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("polyline",{points:"4 14 10 14 10 20"}),p("polyline",{points:"20 10 14 10 14 4"}),p("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),p("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Jn({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("circle",{cx:"12",cy:"12",r:"10"}),p("path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}),p("path",{d:"M12 17h.01"})]})}function er({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("path",{d:"M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1"}),p("circle",{cx:"12",cy:"19",r:"0.5",fill:"currentColor"})]})}function tr({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:p("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})})}function nr({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),p("polyline",{points:"14 2 14 8 20 8"})]})}function rr({className:t}){return p("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p("circle",{cx:"11",cy:"11",r:"8"}),p("path",{d:"m21 21-4.3-4.3"})]})}x.setOptions({breaks:!0,gfm:!0});const Ut=new x.Renderer;Ut.link=({href:t,title:e,text:n})=>{const r=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${r}>${n}</a>`},x.use({renderer:Ut});function or(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function sr(t,e){if(!t)return"";let n=t;return n=n.replace(/【[^】]*】/g,""),n=n.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),n=n.replace(/\[Source:[^\]]*\]/gi,""),n=n.replace(/\(Source:[^)]*\)/gi,""),e&&e.length>0?n=n.replace(/\[(\d+)\]/g,(o,s)=>{const l=parseInt(s,10),i=e.find(c=>c.index===l);if(i){const c=i.title||i.url||`Source ${l}`,a=i.url||"#",d=c.replace(/"/g,"&quot;"),u=(i.snippet||"").replace(/"/g,"&quot;").slice(0,100);return`<a href="${a}" target="_blank" rel="noopener noreferrer" class="grounded-inline-citation" data-citation-index="${l}" title="${d}: ${u}...">[${l}]</a>`}return o}):n=n.replace(/\[\d+\]/g,""),x.parse(n,{async:!1})}function ir({message:t}){const[e,n]=N(!1),r=t.role==="user",o=t.citations&&t.citations.length>0;return p("div",{className:`grounded-message ${t.role}`,children:[p("div",{className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:r?or(t.content):sr(t.content,t.citations)}}),t.isStreaming&&p("span",{className:"grounded-cursor"}),!r&&o&&p("div",{className:"grounded-sources",children:[p("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>n(!e),children:[p(jt,{}),t.citations.length," source",t.citations.length!==1?"s":"",p(Yn,{})]}),p("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((s,l)=>{var a;const i=(a=s.url)==null?void 0:a.startsWith("upload://"),c=s.title||(i?"Uploaded Document":s.url)||`Source ${l+1}`;return i?p("div",{className:"grounded-source grounded-source-file",children:[p(nr,{}),p("span",{className:"grounded-source-title",children:c})]},l):p("a",{href:s.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[p(jt,{}),p("span",{className:"grounded-source-title",children:c})]},l)})})]})]})}function ar({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return p("div",{className:"grounded-status",children:p("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return p(rr,{className:"grounded-status-icon"});case"generating":return p(Wt,{className:"grounded-status-icon"});default:return null}})(),p("span",{className:"grounded-status-text",children:e()}),p("div",{className:"grounded-status-dots",children:[p("div",{className:"grounded-typing-dot"}),p("div",{className:"grounded-typing-dot"}),p("div",{className:"grounded-typing-dot"})]})]})})}function Gt({options:t,initialOpen:e=!1,onOpenChange:n}){var Zt,Qt,Vt,Yt,Xt,Kt;const{token:r,apiBase:o="",position:s="bottom-right"}=t,[l,i]=N(e),[c,a]=N(!1),[d,u]=N(""),h=oe(null),f=oe(null),{config:g}=cn({token:r,apiBase:o}),{messages:k,isLoading:v,chatStatus:m,sendMessage:_}=un({token:r,apiBase:o});re(()=>{h.current&&h.current.scrollIntoView({behavior:"smooth"})},[k,v]),re(()=>{l&&f.current&&setTimeout(()=>{var L;return(L=f.current)==null?void 0:L.focus()},100)},[l]);const A=oe(!1);re(()=>{A.current&&!v&&l&&setTimeout(()=>{var L;return(L=f.current)==null?void 0:L.focus()},50),A.current=v},[v,l]),re(()=>{n==null||n(l)},[l,n]);const C=()=>{i(!l)},M=()=>{d.trim()&&!v&&(_(d),u(""),f.current&&(f.current.style.height="auto"),setTimeout(()=>{var L;(L=f.current)==null||L.focus()},50))},R=L=>{L.key==="Enter"&&!L.shiftKey&&(L.preventDefault(),M())},T=L=>{const Se=L.target;u(Se.value),Se.style.height="auto",Se.style.height=Math.min(Se.scrollHeight,120)+"px"},D=s==="bottom-left",P=(g==null?void 0:g.agentName)||"Assistant",G=(g==null?void 0:g.welcomeMessage)||"How can I help?",I=(g==null?void 0:g.description)||"Ask me anything. I'm here to assist you.",F=g==null?void 0:g.logoUrl,O=k.length===0&&!v,Z=((Zt=g==null?void 0:g.theme)==null?void 0:Zt.buttonStyle)||"circle",ye=((Qt=g==null?void 0:g.theme)==null?void 0:Qt.buttonSize)||"medium",de=((Vt=g==null?void 0:g.theme)==null?void 0:Vt.buttonText)||"Chat with us",z=((Yt=g==null?void 0:g.theme)==null?void 0:Yt.buttonIcon)||"chat",Qe=((Xt=g==null?void 0:g.theme)==null?void 0:Xt.buttonColor)||"#2563eb",J=(Kt=g==null?void 0:g.theme)==null?void 0:Kt.customIconUrl,ur=()=>{if(J)return p("img",{src:J,alt:"",className:"grounded-launcher-custom-icon"});switch(z){case"help":return p(Jn,{});case"question":return p(er,{});case"message":return p(tr,{});case"chat":default:return p(Qn,{})}};return p("div",{className:`grounded-container ${D?"left":""}`,children:[p("div",{className:`grounded-window ${l?"open":""} ${c?"expanded":""}`,children:[p("div",{className:"grounded-header",children:[p("div",{className:"grounded-header-left",children:[F&&p("img",{src:F,alt:"",className:"grounded-header-logo"}),p("h2",{className:"grounded-header-title",children:P})]}),p("div",{className:"grounded-header-actions",children:[p("button",{className:"grounded-header-btn",onClick:()=>a(!c),"aria-label":c?"Shrink chat":"Expand chat",children:c?p(Kn,{}):p(Xn,{})}),p("button",{className:"grounded-header-btn",onClick:C,"aria-label":"Close chat",children:p(Dt,{})})]})]}),p("div",{className:"grounded-messages",children:[O?p("div",{className:"grounded-empty",children:[p(Wt,{className:"grounded-empty-icon"}),p("h3",{className:"grounded-empty-title",children:I}),p("p",{className:"grounded-empty-text",children:G})]}):p(X,{children:[k.map(L=>p(ir,{message:L},L.id)),(v||m.status!=="idle")&&m.status!=="streaming"&&p(ar,{status:m})]}),p("div",{ref:h})]}),p("div",{className:"grounded-input-area",children:p("div",{className:"grounded-input-container",children:[p("textarea",{ref:f,className:"grounded-input",placeholder:"Type a message...",value:d,onInput:T,onKeyDown:R,rows:1,disabled:v}),p("button",{className:"grounded-send",onClick:M,disabled:!d.trim()||v,"aria-label":"Send message",children:p(Vn,{})})]})}),p("div",{className:"grounded-footer",children:["Powered by ",p("a",{href:"https://grounded.ai",target:"_blank",rel:"noopener",children:"Grounded"})]})]}),p("button",{className:`grounded-launcher grounded-launcher--${Z} grounded-launcher--${ye} ${l?"open":""}`,onClick:C,"aria-label":l?"Close chat":"Open chat",style:{backgroundColor:Qe},children:l?p(Dt,{}):p(X,{children:[ur(),Z==="pill"&&p("span",{className:"grounded-launcher-text",children:de})]})})]})}const lr=`
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Noto+Sans:wght@400;500;600&display=swap');

  :host {
    /* Color System - Cool Blue Palette */
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
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
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

  /* Custom icon image */
  .grounded-launcher-custom-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
    transition: transform var(--grounded-duration-normal) var(--grounded-ease-out);
  }

  .grounded-launcher--small .grounded-launcher-custom-icon {
    width: 20px;
    height: 20px;
  }

  .grounded-launcher--large .grounded-launcher-custom-icon {
    width: 28px;
    height: 28px;
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
    background: #1E293B;
    color: #E2E8F0;
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
    border-radius: var(--grounded-radius-md);
    padding: var(--grounded-space-sm);
    transition: box-shadow var(--grounded-duration-fast);
  }

  .grounded-input-container:focus-within {
    box-shadow: 0 0 0 2px var(--grounded-accent);
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
    justify-content: center;
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

  /* Inline Citations */
  .grounded-inline-citation {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--grounded-accent-subtle);
    color: var(--grounded-accent);
    font-size: 11px;
    font-weight: 600;
    font-family: var(--grounded-font-mono);
    padding: 1px 5px;
    border-radius: 4px;
    margin: 0 1px;
    text-decoration: none;
    cursor: pointer;
    transition: all var(--grounded-duration-fast);
    vertical-align: super;
    line-height: 1;
  }

  .grounded-inline-citation:hover {
    background: var(--grounded-accent);
    color: var(--grounded-text-inverse);
    transform: scale(1.1);
  }
`;class dr{constructor(){this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.processQueue()}processQueue(){var n;const e=((n=window.grounded)==null?void 0:n.q)||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,n){switch(e){case"init":this.init(n);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[Grounded Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[Grounded Widget] Already initialized");return}if(!(e!=null&&e.token)){console.error("[Grounded Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase()},this.container=document.createElement("div"),this.container.id="grounded-widget-root",document.body.appendChild(this.container),this.shadowRoot=this.container.attachShadow({mode:"open"});const n=document.createElement("style");n.textContent=lr,this.shadowRoot.appendChild(n);const r=document.createElement("div");this.shadowRoot.appendChild(r),pt(p(Gt,{options:this.options,initialOpen:this.openState,onOpenChange:o=>{var s;this.openState=o,(s=this.openCallback)==null||s.call(this,o)}}),r),this.isInitialized=!0,console.log("[Grounded Widget] Initialized")}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const n of e){const r=n.getAttribute("src");if(r)try{return new URL(r,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){if(!this.shadowRoot||!this.options)return;const e=this.shadowRoot.querySelector("div:last-child");e&&pt(p(Gt,{options:this.options,initialOpen:this.openState,onOpenChange:n=>{var r;this.openState=n,(r=this.openCallback)==null||r.call(this,n)}}),e)}destroy(){this.container&&this.container.remove(),this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[Grounded Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const Oe=new dr;function Ot(t,e){Oe.handleCommand(t,e)}return window.grounded=Ot,window.GroundedWidget=Oe,q.GroundedWidget=Oe,q.grounded=Ot,Object.defineProperty(q,Symbol.toStringTag,{value:"Module"}),q}({});
