var GroundedWidget=(function(le){"use strict";var de,w,Qe,D,Ve,Ye,Xe,Ke,ye,Se,$e,X={},Je=[],Gt=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,ce=Array.isArray;function F(t,e){for(var r in e)t[r]=e[r];return t}function ze(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function Qt(t,e,r){var o,n,s,a={};for(s in e)s=="key"?o=e[s]:s=="ref"?n=e[s]:a[s]=e[s];if(arguments.length>2&&(a.children=arguments.length>3?de.call(arguments,2):r),typeof t=="function"&&t.defaultProps!=null)for(s in t.defaultProps)a[s]===void 0&&(a[s]=t.defaultProps[s]);return ue(t,a,o,n,null)}function ue(t,e,r,o,n){var s={type:t,props:e,key:r,ref:o,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:n??++Qe,__i:-1,__u:0};return n==null&&w.vnode!=null&&w.vnode(s),s}function G(t){return t.children}function pe(t,e){this.props=t,this.context=e}function Q(t,e){if(e==null)return t.__?Q(t.__,t.__i+1):null;for(var r;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null)return r.__e;return typeof t.type=="function"?Q(t):null}function et(t){var e,r;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((r=t.__k[e])!=null&&r.__e!=null){t.__e=t.__c.base=r.__e;break}return et(t)}}function tt(t){(!t.__d&&(t.__d=!0)&&D.push(t)&&!ge.__r++||Ve!=w.debounceRendering)&&((Ve=w.debounceRendering)||Ye)(ge)}function ge(){for(var t,e,r,o,n,s,a,d=1;D.length;)D.length>d&&D.sort(Xe),t=D.shift(),d=D.length,t.__d&&(r=void 0,o=void 0,n=(o=(e=t).__v).__e,s=[],a=[],e.__P&&((r=F({},o)).__v=o.__v+1,w.vnode&&w.vnode(r),Ce(e.__P,r,o,e.__n,e.__P.namespaceURI,32&o.__u?[n]:null,s,n??Q(o),!!(32&o.__u),a),r.__v=o.__v,r.__.__k[r.__i]=r,at(s,r,a),o.__e=o.__=null,r.__e!=n&&et(r)));ge.__r=0}function rt(t,e,r,o,n,s,a,d,i,c,p){var l,h,g,f,x,v,b,m=o&&o.__k||Je,A=e.length;for(i=Vt(r,e,m,i,A),l=0;l<A;l++)(g=r.__k[l])!=null&&(h=g.__i==-1?X:m[g.__i]||X,g.__i=l,v=Ce(t,g,h,n,s,a,d,i,c,p),f=g.__e,g.ref&&h.ref!=g.ref&&(h.ref&&Te(h.ref,null,g),p.push(g.ref,g.__c||f,g)),x==null&&f!=null&&(x=f),(b=!!(4&g.__u))||h.__k===g.__k?i=nt(g,i,t,b):typeof g.type=="function"&&v!==void 0?i=v:f&&(i=f.nextSibling),g.__u&=-7);return r.__e=x,i}function Vt(t,e,r,o,n){var s,a,d,i,c,p=r.length,l=p,h=0;for(t.__k=new Array(n),s=0;s<n;s++)(a=e[s])!=null&&typeof a!="boolean"&&typeof a!="function"?(typeof a=="string"||typeof a=="number"||typeof a=="bigint"||a.constructor==String?a=t.__k[s]=ue(null,a,null,null,null):ce(a)?a=t.__k[s]=ue(G,{children:a},null,null,null):a.constructor===void 0&&a.__b>0?a=t.__k[s]=ue(a.type,a.props,a.key,a.ref?a.ref:null,a.__v):t.__k[s]=a,i=s+h,a.__=t,a.__b=t.__b+1,d=null,(c=a.__i=Yt(a,r,i,l))!=-1&&(l--,(d=r[c])&&(d.__u|=2)),d==null||d.__v==null?(c==-1&&(n>p?h--:n<p&&h++),typeof a.type!="function"&&(a.__u|=4)):c!=i&&(c==i-1?h--:c==i+1?h++:(c>i?h--:h++,a.__u|=4))):t.__k[s]=null;if(l)for(s=0;s<p;s++)(d=r[s])!=null&&(2&d.__u)==0&&(d.__e==o&&(o=Q(d)),lt(d,d));return o}function nt(t,e,r,o){var n,s;if(typeof t.type=="function"){for(n=t.__k,s=0;n&&s<n.length;s++)n[s]&&(n[s].__=t,e=nt(n[s],e,r,o));return e}t.__e!=e&&(o&&(e&&t.type&&!e.parentNode&&(e=Q(t)),r.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function Yt(t,e,r,o){var n,s,a,d=t.key,i=t.type,c=e[r],p=c!=null&&(2&c.__u)==0;if(c===null&&d==null||p&&d==c.key&&i==c.type)return r;if(o>(p?1:0)){for(n=r-1,s=r+1;n>=0||s<e.length;)if((c=e[a=n>=0?n--:s++])!=null&&(2&c.__u)==0&&d==c.key&&i==c.type)return a}return-1}function ot(t,e,r){e[0]=="-"?t.setProperty(e,r??""):t[e]=r==null?"":typeof r!="number"||Gt.test(e)?r:r+"px"}function he(t,e,r,o,n){var s,a;e:if(e=="style")if(typeof r=="string")t.style.cssText=r;else{if(typeof o=="string"&&(t.style.cssText=o=""),o)for(e in o)r&&e in r||ot(t.style,e,"");if(r)for(e in r)o&&r[e]==o[e]||ot(t.style,e,r[e])}else if(e[0]=="o"&&e[1]=="n")s=e!=(e=e.replace(Ke,"$1")),a=e.toLowerCase(),e=a in t||e=="onFocusOut"||e=="onFocusIn"?a.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+s]=r,r?o?r.u=o.u:(r.u=ye,t.addEventListener(e,s?$e:Se,s)):t.removeEventListener(e,s?$e:Se,s);else{if(n=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=r??"";break e}catch{}typeof r=="function"||(r==null||r===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&r==1?"":r))}}function st(t){return function(e){if(this.l){var r=this.l[e.type+t];if(e.t==null)e.t=ye++;else if(e.t<r.u)return;return r(w.event?w.event(e):e)}}}function Ce(t,e,r,o,n,s,a,d,i,c){var p,l,h,g,f,x,v,b,m,A,$,y,T,W,E,q,H,L=e.type;if(e.constructor!==void 0)return null;128&r.__u&&(i=!!(32&r.__u),s=[d=e.__e=r.__e]),(p=w.__b)&&p(e);e:if(typeof L=="function")try{if(b=e.props,m="prototype"in L&&L.prototype.render,A=(p=L.contextType)&&o[p.__c],$=p?A?A.props.value:p.__:o,r.__c?v=(l=e.__c=r.__c).__=l.__E:(m?e.__c=l=new L(b,$):(e.__c=l=new pe(b,$),l.constructor=L,l.render=Kt),A&&A.sub(l),l.state||(l.state={}),l.__n=o,h=l.__d=!0,l.__h=[],l._sb=[]),m&&l.__s==null&&(l.__s=l.state),m&&L.getDerivedStateFromProps!=null&&(l.__s==l.state&&(l.__s=F({},l.__s)),F(l.__s,L.getDerivedStateFromProps(b,l.__s))),g=l.props,f=l.state,l.__v=e,h)m&&L.getDerivedStateFromProps==null&&l.componentWillMount!=null&&l.componentWillMount(),m&&l.componentDidMount!=null&&l.__h.push(l.componentDidMount);else{if(m&&L.getDerivedStateFromProps==null&&b!==g&&l.componentWillReceiveProps!=null&&l.componentWillReceiveProps(b,$),e.__v==r.__v||!l.__e&&l.shouldComponentUpdate!=null&&l.shouldComponentUpdate(b,l.__s,$)===!1){for(e.__v!=r.__v&&(l.props=b,l.state=l.__s,l.__d=!1),e.__e=r.__e,e.__k=r.__k,e.__k.some(function(R){R&&(R.__=e)}),y=0;y<l._sb.length;y++)l.__h.push(l._sb[y]);l._sb=[],l.__h.length&&a.push(l);break e}l.componentWillUpdate!=null&&l.componentWillUpdate(b,l.__s,$),m&&l.componentDidUpdate!=null&&l.__h.push(function(){l.componentDidUpdate(g,f,x)})}if(l.context=$,l.props=b,l.__P=t,l.__e=!1,T=w.__r,W=0,m){for(l.state=l.__s,l.__d=!1,T&&T(e),p=l.render(l.props,l.state,l.context),E=0;E<l._sb.length;E++)l.__h.push(l._sb[E]);l._sb=[]}else do l.__d=!1,T&&T(e),p=l.render(l.props,l.state,l.context),l.state=l.__s;while(l.__d&&++W<25);l.state=l.__s,l.getChildContext!=null&&(o=F(F({},o),l.getChildContext())),m&&!h&&l.getSnapshotBeforeUpdate!=null&&(x=l.getSnapshotBeforeUpdate(g,f)),q=p,p!=null&&p.type===G&&p.key==null&&(q=it(p.props.children)),d=rt(t,ce(q)?q:[q],e,r,o,n,s,a,d,i,c),l.base=e.__e,e.__u&=-161,l.__h.length&&a.push(l),v&&(l.__E=l.__=null)}catch(R){if(e.__v=null,i||s!=null)if(R.then){for(e.__u|=i?160:128;d&&d.nodeType==8&&d.nextSibling;)d=d.nextSibling;s[s.indexOf(d)]=null,e.__e=d}else{for(H=s.length;H--;)ze(s[H]);Re(e)}else e.__e=r.__e,e.__k=r.__k,R.then||Re(e);w.__e(R,e,r)}else s==null&&e.__v==r.__v?(e.__k=r.__k,e.__e=r.__e):d=e.__e=Xt(r.__e,e,r,o,n,s,a,i,c);return(p=w.diffed)&&p(e),128&e.__u?void 0:d}function Re(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(Re)}function at(t,e,r){for(var o=0;o<r.length;o++)Te(r[o],r[++o],r[++o]);w.__c&&w.__c(e,t),t.some(function(n){try{t=n.__h,n.__h=[],t.some(function(s){s.call(n)})}catch(s){w.__e(s,n.__v)}})}function it(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:ce(t)?t.map(it):F({},t)}function Xt(t,e,r,o,n,s,a,d,i){var c,p,l,h,g,f,x,v=r.props||X,b=e.props,m=e.type;if(m=="svg"?n="http://www.w3.org/2000/svg":m=="math"?n="http://www.w3.org/1998/Math/MathML":n||(n="http://www.w3.org/1999/xhtml"),s!=null){for(c=0;c<s.length;c++)if((g=s[c])&&"setAttribute"in g==!!m&&(m?g.localName==m:g.nodeType==3)){t=g,s[c]=null;break}}if(t==null){if(m==null)return document.createTextNode(b);t=document.createElementNS(n,m,b.is&&b),d&&(w.__m&&w.__m(e,s),d=!1),s=null}if(m==null)v===b||d&&t.data==b||(t.data=b);else{if(s=s&&de.call(t.childNodes),!d&&s!=null)for(v={},c=0;c<t.attributes.length;c++)v[(g=t.attributes[c]).name]=g.value;for(c in v)if(g=v[c],c!="children"){if(c=="dangerouslySetInnerHTML")l=g;else if(!(c in b)){if(c=="value"&&"defaultValue"in b||c=="checked"&&"defaultChecked"in b)continue;he(t,c,null,g,n)}}for(c in b)g=b[c],c=="children"?h=g:c=="dangerouslySetInnerHTML"?p=g:c=="value"?f=g:c=="checked"?x=g:d&&typeof g!="function"||v[c]===g||he(t,c,g,v[c],n);if(p)d||l&&(p.__html==l.__html||p.__html==t.innerHTML)||(t.innerHTML=p.__html),e.__k=[];else if(l&&(t.innerHTML=""),rt(e.type=="template"?t.content:t,ce(h)?h:[h],e,r,o,m=="foreignObject"?"http://www.w3.org/1999/xhtml":n,s,a,s?s[0]:r.__k&&Q(r,0),d,i),s!=null)for(c=s.length;c--;)ze(s[c]);d||(c="value",m=="progress"&&f==null?t.removeAttribute("value"):f!=null&&(f!==t[c]||m=="progress"&&!f||m=="option"&&f!=v[c])&&he(t,c,f,v[c],n),c="checked",x!=null&&x!=t[c]&&he(t,c,x,v[c],n))}return t}function Te(t,e,r){try{if(typeof t=="function"){var o=typeof t.__u=="function";o&&t.__u(),o&&e==null||(t.__u=t(e))}else t.current=e}catch(n){w.__e(n,r)}}function lt(t,e,r){var o,n;if(w.unmount&&w.unmount(t),(o=t.ref)&&(o.current&&o.current!=t.__e||Te(o,null,e)),(o=t.__c)!=null){if(o.componentWillUnmount)try{o.componentWillUnmount()}catch(s){w.__e(s,e)}o.base=o.__P=null}if(o=t.__k)for(n=0;n<o.length;n++)o[n]&&lt(o[n],e,r||typeof t.type!="function");r||ze(t.__e),t.__c=t.__=t.__e=void 0}function Kt(t,e,r){return this.constructor(t,r)}function dt(t,e,r){var o,n,s,a;e==document&&(e=document.documentElement),w.__&&w.__(t,e),n=(o=!1)?null:e.__k,s=[],a=[],Ce(e,t=e.__k=Qt(G,null,[t]),n||X,X,e.namespaceURI,n?null:e.firstChild?de.call(e.childNodes):null,s,n?n.__e:e.firstChild,o,a),at(s,t,a)}de=Je.slice,w={__e:function(t,e,r,o){for(var n,s,a;e=e.__;)if((n=e.__c)&&!n.__)try{if((s=n.constructor)&&s.getDerivedStateFromError!=null&&(n.setState(s.getDerivedStateFromError(t)),a=n.__d),n.componentDidCatch!=null&&(n.componentDidCatch(t,o||{}),a=n.__d),a)return n.__E=n}catch(d){t=d}throw t}},Qe=0,pe.prototype.setState=function(t,e){var r;r=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=F({},this.state),typeof t=="function"&&(t=t(F({},r),this.props)),t&&F(r,t),t!=null&&this.__v&&(e&&this._sb.push(e),tt(this))},pe.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),tt(this))},pe.prototype.render=G,D=[],Ye=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,Xe=function(t,e){return t.__v.__b-e.__v.__b},ge.__r=0,Ke=/(PointerCapture)$|Capture$/i,ye=0,Se=st(!1),$e=st(!0);var Jt=0;function u(t,e,r,o,n,s){e||(e={});var a,d,i=e;if("ref"in i)for(d in i={},e)d=="ref"?a=e[d]:i[d]=e[d];var c={type:t,props:i,key:r,ref:a,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--Jt,__i:-1,__u:0,__source:n,__self:s};if(typeof t=="function"&&(a=t.defaultProps))for(d in a)i[d]===void 0&&(i[d]=a[d]);return w.vnode&&w.vnode(c),c}var K,S,Ie,ct,J=0,ut=[],z=w,pt=z.__b,gt=z.__r,ht=z.diffed,ft=z.__c,mt=z.unmount,bt=z.__;function Ae(t,e){z.__h&&z.__h(S,t,J||e),J=0;var r=S.__H||(S.__H={__:[],__h:[]});return t>=r.__.length&&r.__.push({}),r.__[t]}function N(t){return J=1,er(vt,t)}function er(t,e,r){var o=Ae(K++,2);if(o.t=t,!o.__c&&(o.__=[vt(void 0,e),function(d){var i=o.__N?o.__N[0]:o.__[0],c=o.t(i,d);i!==c&&(o.__N=[c,o.__[1]],o.__c.setState({}))}],o.__c=S,!S.__f)){var n=function(d,i,c){if(!o.__c.__H)return!0;var p=o.__c.__H.__.filter(function(h){return!!h.__c});if(p.every(function(h){return!h.__N}))return!s||s.call(this,d,i,c);var l=o.__c.props!==d;return p.forEach(function(h){if(h.__N){var g=h.__[0];h.__=h.__N,h.__N=void 0,g!==h.__[0]&&(l=!0)}}),s&&s.call(this,d,i,c)||l};S.__f=!0;var s=S.shouldComponentUpdate,a=S.componentWillUpdate;S.componentWillUpdate=function(d,i,c){if(this.__e){var p=s;s=void 0,n(d,i,c),s=p}a&&a.call(this,d,i,c)},S.shouldComponentUpdate=n}return o.__N||o.__}function V(t,e){var r=Ae(K++,3);!z.__s&&xt(r.__H,e)&&(r.__=t,r.u=e,S.__H.__h.push(r))}function Y(t){return J=5,_t(function(){return{current:t}},[])}function _t(t,e){var r=Ae(K++,7);return xt(r.__H,e)&&(r.__=t(),r.__H=e,r.__h=t),r.__}function Le(t,e){return J=8,_t(function(){return t},e)}function tr(){for(var t;t=ut.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(fe),t.__H.__h.forEach(Ee),t.__H.__h=[]}catch(e){t.__H.__h=[],z.__e(e,t.__v)}}z.__b=function(t){S=null,pt&&pt(t)},z.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),bt&&bt(t,e)},z.__r=function(t){gt&&gt(t),K=0;var e=(S=t.__c).__H;e&&(Ie===S?(e.__h=[],S.__h=[],e.__.forEach(function(r){r.__N&&(r.__=r.__N),r.u=r.__N=void 0})):(e.__h.forEach(fe),e.__h.forEach(Ee),e.__h=[],K=0)),Ie=S},z.diffed=function(t){ht&&ht(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(ut.push(e)!==1&&ct===z.requestAnimationFrame||((ct=z.requestAnimationFrame)||rr)(tr)),e.__H.__.forEach(function(r){r.u&&(r.__H=r.u),r.u=void 0})),Ie=S=null},z.__c=function(t,e){e.some(function(r){try{r.__h.forEach(fe),r.__h=r.__h.filter(function(o){return!o.__||Ee(o)})}catch(o){e.some(function(n){n.__h&&(n.__h=[])}),e=[],z.__e(o,r.__v)}}),ft&&ft(t,e)},z.unmount=function(t){mt&&mt(t);var e,r=t.__c;r&&r.__H&&(r.__H.__.forEach(function(o){try{fe(o)}catch(n){e=n}}),r.__H=void 0,e&&z.__e(e,r.__v))};var kt=typeof requestAnimationFrame=="function";function rr(t){var e,r=function(){clearTimeout(o),kt&&cancelAnimationFrame(e),setTimeout(t)},o=setTimeout(r,35);kt&&(e=requestAnimationFrame(r))}function fe(t){var e=S,r=t.__c;typeof r=="function"&&(t.__c=void 0,r()),S=e}function Ee(t){var e=S;t.__c=t.__(),S=e}function xt(t,e){return!t||t.length!==e.length||e.some(function(r,o){return r!==t[o]})}function vt(t,e){return typeof e=="function"?e(t):e}function nr({token:t,apiBase:e}){const[r,o]=N([]),[n,s]=N(!1),[a,d]=N(!1),[i,c]=N(null),[p,l]=N({status:"idle"}),h=Y(typeof sessionStorage<"u"?sessionStorage.getItem(`grounded_conv_${t}`):null),g=Y(null),f=()=>Math.random().toString(36).slice(2,11),x=Le(async m=>{if(!m.trim()||n||a)return;const A={id:f(),role:"user",content:m.trim(),timestamp:Date.now()},$=f();o(y=>[...y,A]),s(!0),d(!0),c(null),l({status:"searching",message:"Searching knowledge base..."}),g.current=new AbortController;try{const y={message:m.trim()};h.current&&(y.conversationId=h.current);const T=await fetch(`${e}/api/v1/widget/${t}/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(y),signal:g.current.signal});if(!T.ok){const R=await T.json().catch(()=>({}));throw new Error(R.message||`Request failed: ${T.status}`)}o(R=>[...R,{id:$,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),s(!1);const W=T.body?.getReader();if(!W)throw new Error("No response body");const E=new TextDecoder;let q="",H="",L=[];for(;;){const{done:R,value:Z}=await W.read();if(R)break;q+=E.decode(Z,{stream:!0});const se=q.split(`
`);q=se.pop()||"";for(const ae of se)if(ae.startsWith("data: "))try{const C=JSON.parse(ae.slice(6));if(C.type==="status")l({status:C.status||"searching",message:C.message,sourcesCount:C.sourcesCount}),C.status==="generating"&&l({status:"generating",message:C.message,sourcesCount:C.sourcesCount});else if(C.type==="text"&&C.content)H||l({status:"streaming"}),H+=C.content,o(Ue=>Ue.map(ie=>ie.id===$?{...ie,content:H}:ie));else if(C.type==="done"){if(C.conversationId){h.current=C.conversationId;try{sessionStorage.setItem(`grounded_conv_${t}`,C.conversationId)}catch{}}L=C.citations||[],l({status:"idle"})}else if(C.type==="error")throw new Error(C.message||"Stream error")}catch{console.warn("[Grounded Widget] Failed to parse SSE:",ae)}}o(R=>R.map(Z=>Z.id===$?{...Z,content:H,isStreaming:!1,citations:L}:Z))}catch(y){if(y.name==="AbortError"){l({status:"idle"});return}l({status:"idle"}),c(y instanceof Error?y.message:"An error occurred"),o(T=>T.some(E=>E.id===$)?T.map(E=>E.id===$?{...E,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:E):[...T,{id:$,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{s(!1),d(!1),g.current=null}},[t,e,n,a]),v=Le(()=>{g.current&&(g.current.abort(),g.current=null),d(!1),s(!1)},[]),b=Le(()=>{o([]),h.current=null;try{sessionStorage.removeItem(`grounded_conv_${t}`)}catch{}},[t]);return{messages:r,isLoading:n,isStreaming:a,error:i,chatStatus:p,sendMessage:x,stopStreaming:v,clearMessages:b}}function or({token:t,apiBase:e}){const[r,o]=N(null),[n,s]=N(!0),[a,d]=N(null);return V(()=>{async function i(){try{const c=await fetch(`${e}/api/v1/widget/${t}/config`);if(!c.ok)throw new Error("Failed to load widget configuration");const p=await c.json();o(p)}catch(c){d(c instanceof Error?c.message:"Configuration error"),o({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0})}finally{s(!1)}}i()},[t,e]),{config:r,isLoading:n,error:a}}function Ne(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var O=Ne();function wt(t){O=t}var ee={exec:()=>null};function _(t,e=""){let r=typeof t=="string"?t:t.source,o={replace:(n,s)=>{let a=typeof s=="string"?s:s.source;return a=a.replace(I.caret,"$1"),r=r.replace(n,a),o},getRegex:()=>new RegExp(r,e)};return o}var sr=(()=>{try{return!!new RegExp("(?<=1)(?<!1)")}catch{return!1}})(),I={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] +\S/,listReplaceTask:/^\[[ xX]\] +/,listTaskCheckbox:/\[[ xX]\]/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},ar=/^(?:[ \t]*(?:\n|$))+/,ir=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,lr=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,te=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,dr=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Be=/(?:[*+-]|\d{1,9}[.)])/,yt=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,St=_(yt).replace(/bull/g,Be).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),cr=_(yt).replace(/bull/g,Be).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Me=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,ur=/^[^\n]+/,Pe=/(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/,pr=_(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",Pe).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),gr=_(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Be).getRegex(),me="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",qe=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,hr=_("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",qe).replace("tag",me).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),$t=_(Me).replace("hr",te).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",me).getRegex(),fr=_(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",$t).getRegex(),He={blockquote:fr,code:ir,def:pr,fences:lr,heading:dr,hr:te,html:hr,lheading:St,list:gr,newline:ar,paragraph:$t,table:ee,text:ur},zt=_("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",te).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",me).getRegex(),mr={...He,lheading:cr,table:zt,paragraph:_(Me).replace("hr",te).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",zt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",me).getRegex()},br={...He,html:_(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",qe).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:ee,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:_(Me).replace("hr",te).replace("heading",` *#{1,6} *[^
]`).replace("lheading",St).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},_r=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,kr=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,Ct=/^( {2,}|\\)\n(?!\s*$)/,xr=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,be=/[\p{P}\p{S}]/u,Fe=/[\s\p{P}\p{S}]/u,Rt=/[^\s\p{P}\p{S}]/u,vr=_(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,Fe).getRegex(),Tt=/(?!~)[\p{P}\p{S}]/u,wr=/(?!~)[\s\p{P}\p{S}]/u,yr=/(?:[^\s\p{P}\p{S}]|~)/u,Sr=_(/link|precode-code|html/,"g").replace("link",/\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-",sr?"(?<!`)()":"(^^|[^`])").replace("code",/(?<b>`+)[^`]+\k<b>(?!`)/).replace("html",/<(?! )[^<>]*?>/).getRegex(),It=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,$r=_(It,"u").replace(/punct/g,be).getRegex(),zr=_(It,"u").replace(/punct/g,Tt).getRegex(),At="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Cr=_(At,"gu").replace(/notPunctSpace/g,Rt).replace(/punctSpace/g,Fe).replace(/punct/g,be).getRegex(),Rr=_(At,"gu").replace(/notPunctSpace/g,yr).replace(/punctSpace/g,wr).replace(/punct/g,Tt).getRegex(),Tr=_("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Rt).replace(/punctSpace/g,Fe).replace(/punct/g,be).getRegex(),Ir=_(/\\(punct)/,"gu").replace(/punct/g,be).getRegex(),Ar=_(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Lr=_(qe).replace("(?:-->|$)","-->").getRegex(),Er=_("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Lr).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),_e=/(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+[^`]*?`+(?!`)|[^\[\]\\`])*?/,Nr=_(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",_e).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Lt=_(/^!?\[(label)\]\[(ref)\]/).replace("label",_e).replace("ref",Pe).getRegex(),Et=_(/^!?\[(ref)\](?:\[\])?/).replace("ref",Pe).getRegex(),Br=_("reflink|nolink(?!\\()","g").replace("reflink",Lt).replace("nolink",Et).getRegex(),Nt=/[hH][tT][tT][pP][sS]?|[fF][tT][pP]/,je={_backpedal:ee,anyPunctuation:Ir,autolink:Ar,blockSkip:Sr,br:Ct,code:kr,del:ee,emStrongLDelim:$r,emStrongRDelimAst:Cr,emStrongRDelimUnd:Tr,escape:_r,link:Nr,nolink:Et,punctuation:vr,reflink:Lt,reflinkSearch:Br,tag:Er,text:xr,url:ee},Mr={...je,link:_(/^!?\[(label)\]\((.*?)\)/).replace("label",_e).getRegex(),reflink:_(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",_e).getRegex()},We={...je,emStrongRDelimAst:Rr,emStrongLDelim:zr,url:_(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol",Nt).replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,text:_(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol",Nt).getRegex()},Pr={...We,br:_(Ct).replace("{2,}","*").getRegex(),text:_(We.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},ke={normal:He,gfm:mr,pedantic:br},re={normal:je,gfm:We,breaks:Pr,pedantic:Mr},qr={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Bt=t=>qr[t];function j(t,e){if(e){if(I.escapeTest.test(t))return t.replace(I.escapeReplace,Bt)}else if(I.escapeTestNoEncode.test(t))return t.replace(I.escapeReplaceNoEncode,Bt);return t}function Mt(t){try{t=encodeURI(t).replace(I.percentDecode,"%")}catch{return null}return t}function Pt(t,e){let r=t.replace(I.findPipe,(s,a,d)=>{let i=!1,c=a;for(;--c>=0&&d[c]==="\\";)i=!i;return i?"|":" |"}),o=r.split(I.splitPipe),n=0;if(o[0].trim()||o.shift(),o.length>0&&!o.at(-1)?.trim()&&o.pop(),e)if(o.length>e)o.splice(e);else for(;o.length<e;)o.push("");for(;n<o.length;n++)o[n]=o[n].trim().replace(I.slashPipe,"|");return o}function ne(t,e,r){let o=t.length;if(o===0)return"";let n=0;for(;n<o&&t.charAt(o-n-1)===e;)n++;return t.slice(0,o-n)}function Hr(t,e){if(t.indexOf(e[1])===-1)return-1;let r=0;for(let o=0;o<t.length;o++)if(t[o]==="\\")o++;else if(t[o]===e[0])r++;else if(t[o]===e[1]&&(r--,r<0))return o;return r>0?-2:-1}function qt(t,e,r,o,n){let s=e.href,a=e.title||null,d=t[1].replace(n.other.outputLinkReplace,"$1");o.state.inLink=!0;let i={type:t[0].charAt(0)==="!"?"image":"link",raw:r,href:s,title:a,text:d,tokens:o.inlineTokens(d)};return o.state.inLink=!1,i}function Fr(t,e,r){let o=t.match(r.other.indentCodeCompensation);if(o===null)return e;let n=o[1];return e.split(`
`).map(s=>{let a=s.match(r.other.beginningSpace);if(a===null)return s;let[d]=a;return d.length>=n.length?s.slice(n.length):s}).join(`
`)}var xe=class{options;rules;lexer;constructor(t){this.options=t||O}space(t){let e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){let e=this.rules.block.code.exec(t);if(e){let r=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?r:ne(r,`
`)}}}fences(t){let e=this.rules.block.fences.exec(t);if(e){let r=e[0],o=Fr(r,e[3]||"",this.rules);return{type:"code",raw:r,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:o}}}heading(t){let e=this.rules.block.heading.exec(t);if(e){let r=e[2].trim();if(this.rules.other.endingHash.test(r)){let o=ne(r,"#");(this.options.pedantic||!o||this.rules.other.endingSpaceChar.test(o))&&(r=o.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:r,tokens:this.lexer.inline(r)}}}hr(t){let e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:ne(e[0],`
`)}}blockquote(t){let e=this.rules.block.blockquote.exec(t);if(e){let r=ne(e[0],`
`).split(`
`),o="",n="",s=[];for(;r.length>0;){let a=!1,d=[],i;for(i=0;i<r.length;i++)if(this.rules.other.blockquoteStart.test(r[i]))d.push(r[i]),a=!0;else if(!a)d.push(r[i]);else break;r=r.slice(i);let c=d.join(`
`),p=c.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");o=o?`${o}
${c}`:c,n=n?`${n}
${p}`:p;let l=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(p,s,!0),this.lexer.state.top=l,r.length===0)break;let h=s.at(-1);if(h?.type==="code")break;if(h?.type==="blockquote"){let g=h,f=g.raw+`
`+r.join(`
`),x=this.blockquote(f);s[s.length-1]=x,o=o.substring(0,o.length-g.raw.length)+x.raw,n=n.substring(0,n.length-g.text.length)+x.text;break}else if(h?.type==="list"){let g=h,f=g.raw+`
`+r.join(`
`),x=this.list(f);s[s.length-1]=x,o=o.substring(0,o.length-h.raw.length)+x.raw,n=n.substring(0,n.length-g.raw.length)+x.raw,r=f.substring(s.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:o,tokens:s,text:n}}}list(t){let e=this.rules.block.list.exec(t);if(e){let r=e[1].trim(),o=r.length>1,n={type:"list",raw:"",ordered:o,start:o?+r.slice(0,-1):"",loose:!1,items:[]};r=o?`\\d{1,9}\\${r.slice(-1)}`:`\\${r}`,this.options.pedantic&&(r=o?r:"[*+-]");let s=this.rules.other.listItemRegex(r),a=!1;for(;t;){let i=!1,c="",p="";if(!(e=s.exec(t))||this.rules.block.hr.test(t))break;c=e[0],t=t.substring(c.length);let l=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,x=>" ".repeat(3*x.length)),h=t.split(`
`,1)[0],g=!l.trim(),f=0;if(this.options.pedantic?(f=2,p=l.trimStart()):g?f=e[1].length+1:(f=e[2].search(this.rules.other.nonSpaceChar),f=f>4?1:f,p=l.slice(f),f+=e[1].length),g&&this.rules.other.blankLine.test(h)&&(c+=h+`
`,t=t.substring(h.length+1),i=!0),!i){let x=this.rules.other.nextBulletRegex(f),v=this.rules.other.hrRegex(f),b=this.rules.other.fencesBeginRegex(f),m=this.rules.other.headingBeginRegex(f),A=this.rules.other.htmlBeginRegex(f);for(;t;){let $=t.split(`
`,1)[0],y;if(h=$,this.options.pedantic?(h=h.replace(this.rules.other.listReplaceNesting,"  "),y=h):y=h.replace(this.rules.other.tabCharGlobal,"    "),b.test(h)||m.test(h)||A.test(h)||x.test(h)||v.test(h))break;if(y.search(this.rules.other.nonSpaceChar)>=f||!h.trim())p+=`
`+y.slice(f);else{if(g||l.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||b.test(l)||m.test(l)||v.test(l))break;p+=`
`+h}!g&&!h.trim()&&(g=!0),c+=$+`
`,t=t.substring($.length+1),l=y.slice(f)}}n.loose||(a?n.loose=!0:this.rules.other.doubleBlankLine.test(c)&&(a=!0)),n.items.push({type:"list_item",raw:c,task:!!this.options.gfm&&this.rules.other.listIsTask.test(p),loose:!1,text:p,tokens:[]}),n.raw+=c}let d=n.items.at(-1);if(d)d.raw=d.raw.trimEnd(),d.text=d.text.trimEnd();else return;n.raw=n.raw.trimEnd();for(let i of n.items){if(this.lexer.state.top=!1,i.tokens=this.lexer.blockTokens(i.text,[]),i.task){if(i.text=i.text.replace(this.rules.other.listReplaceTask,""),i.tokens[0]?.type==="text"||i.tokens[0]?.type==="paragraph"){i.tokens[0].raw=i.tokens[0].raw.replace(this.rules.other.listReplaceTask,""),i.tokens[0].text=i.tokens[0].text.replace(this.rules.other.listReplaceTask,"");for(let p=this.lexer.inlineQueue.length-1;p>=0;p--)if(this.rules.other.listIsTask.test(this.lexer.inlineQueue[p].src)){this.lexer.inlineQueue[p].src=this.lexer.inlineQueue[p].src.replace(this.rules.other.listReplaceTask,"");break}}let c=this.rules.other.listTaskCheckbox.exec(i.raw);if(c){let p={type:"checkbox",raw:c[0]+" ",checked:c[0]!=="[ ]"};i.checked=p.checked,n.loose?i.tokens[0]&&["paragraph","text"].includes(i.tokens[0].type)&&"tokens"in i.tokens[0]&&i.tokens[0].tokens?(i.tokens[0].raw=p.raw+i.tokens[0].raw,i.tokens[0].text=p.raw+i.tokens[0].text,i.tokens[0].tokens.unshift(p)):i.tokens.unshift({type:"paragraph",raw:p.raw,text:p.raw,tokens:[p]}):i.tokens.unshift(p)}}if(!n.loose){let c=i.tokens.filter(l=>l.type==="space"),p=c.length>0&&c.some(l=>this.rules.other.anyLine.test(l.raw));n.loose=p}}if(n.loose)for(let i of n.items){i.loose=!0;for(let c of i.tokens)c.type==="text"&&(c.type="paragraph")}return n}}html(t){let e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){let e=this.rules.block.def.exec(t);if(e){let r=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),o=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",n=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:r,raw:e[0],href:o,title:n}}}table(t){let e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;let r=Pt(e[1]),o=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),n=e[3]?.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],s={type:"table",raw:e[0],header:[],align:[],rows:[]};if(r.length===o.length){for(let a of o)this.rules.other.tableAlignRight.test(a)?s.align.push("right"):this.rules.other.tableAlignCenter.test(a)?s.align.push("center"):this.rules.other.tableAlignLeft.test(a)?s.align.push("left"):s.align.push(null);for(let a=0;a<r.length;a++)s.header.push({text:r[a],tokens:this.lexer.inline(r[a]),header:!0,align:s.align[a]});for(let a of n)s.rows.push(Pt(a,s.header.length).map((d,i)=>({text:d,tokens:this.lexer.inline(d),header:!1,align:s.align[i]})));return s}}lheading(t){let e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){let e=this.rules.block.paragraph.exec(t);if(e){let r=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:r,tokens:this.lexer.inline(r)}}}text(t){let e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){let e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){let e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){let e=this.rules.inline.link.exec(t);if(e){let r=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(r)){if(!this.rules.other.endAngleBracket.test(r))return;let s=ne(r.slice(0,-1),"\\");if((r.length-s.length)%2===0)return}else{let s=Hr(e[2],"()");if(s===-2)return;if(s>-1){let a=(e[0].indexOf("!")===0?5:4)+e[1].length+s;e[2]=e[2].substring(0,s),e[0]=e[0].substring(0,a).trim(),e[3]=""}}let o=e[2],n="";if(this.options.pedantic){let s=this.rules.other.pedanticHrefTitle.exec(o);s&&(o=s[1],n=s[3])}else n=e[3]?e[3].slice(1,-1):"";return o=o.trim(),this.rules.other.startAngleBracket.test(o)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(r)?o=o.slice(1):o=o.slice(1,-1)),qt(e,{href:o&&o.replace(this.rules.inline.anyPunctuation,"$1"),title:n&&n.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let r;if((r=this.rules.inline.reflink.exec(t))||(r=this.rules.inline.nolink.exec(t))){let o=(r[2]||r[1]).replace(this.rules.other.multipleSpaceGlobal," "),n=e[o.toLowerCase()];if(!n){let s=r[0].charAt(0);return{type:"text",raw:s,text:s}}return qt(r,n,r[0],this.lexer,this.rules)}}emStrong(t,e,r=""){let o=this.rules.inline.emStrongLDelim.exec(t);if(!(!o||o[3]&&r.match(this.rules.other.unicodeAlphaNumeric))&&(!(o[1]||o[2])||!r||this.rules.inline.punctuation.exec(r))){let n=[...o[0]].length-1,s,a,d=n,i=0,c=o[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,e=e.slice(-1*t.length+n);(o=c.exec(e))!=null;){if(s=o[1]||o[2]||o[3]||o[4]||o[5]||o[6],!s)continue;if(a=[...s].length,o[3]||o[4]){d+=a;continue}else if((o[5]||o[6])&&n%3&&!((n+a)%3)){i+=a;continue}if(d-=a,d>0)continue;a=Math.min(a,a+d+i);let p=[...o[0]][0].length,l=t.slice(0,n+o.index+p+a);if(Math.min(n,a)%2){let g=l.slice(1,-1);return{type:"em",raw:l,text:g,tokens:this.lexer.inlineTokens(g)}}let h=l.slice(2,-2);return{type:"strong",raw:l,text:h,tokens:this.lexer.inlineTokens(h)}}}}codespan(t){let e=this.rules.inline.code.exec(t);if(e){let r=e[2].replace(this.rules.other.newLineCharGlobal," "),o=this.rules.other.nonSpaceChar.test(r),n=this.rules.other.startingSpaceChar.test(r)&&this.rules.other.endingSpaceChar.test(r);return o&&n&&(r=r.substring(1,r.length-1)),{type:"codespan",raw:e[0],text:r}}}br(t){let e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){let e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){let e=this.rules.inline.autolink.exec(t);if(e){let r,o;return e[2]==="@"?(r=e[1],o="mailto:"+r):(r=e[1],o=r),{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}url(t){let e;if(e=this.rules.inline.url.exec(t)){let r,o;if(e[2]==="@")r=e[0],o="mailto:"+r;else{let n;do n=e[0],e[0]=this.rules.inline._backpedal.exec(e[0])?.[0]??"";while(n!==e[0]);r=e[0],e[1]==="www."?o="http://"+e[0]:o=e[0]}return{type:"link",raw:e[0],text:r,href:o,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){let e=this.rules.inline.text.exec(t);if(e){let r=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:r}}}},M=class Ze{tokens;options;state;inlineQueue;tokenizer;constructor(e){this.tokens=[],this.tokens.links=Object.create(null),this.options=e||O,this.options.tokenizer=this.options.tokenizer||new xe,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};let r={other:I,block:ke.normal,inline:re.normal};this.options.pedantic?(r.block=ke.pedantic,r.inline=re.pedantic):this.options.gfm&&(r.block=ke.gfm,this.options.breaks?r.inline=re.breaks:r.inline=re.gfm),this.tokenizer.rules=r}static get rules(){return{block:ke,inline:re}}static lex(e,r){return new Ze(r).lex(e)}static lexInline(e,r){return new Ze(r).inlineTokens(e)}lex(e){e=e.replace(I.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let r=0;r<this.inlineQueue.length;r++){let o=this.inlineQueue[r];this.inlineTokens(o.src,o.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,r=[],o=!1){for(this.options.pedantic&&(e=e.replace(I.tabCharGlobal,"    ").replace(I.spaceLine,""));e;){let n;if(this.options.extensions?.block?.some(a=>(n=a.call({lexer:this},e,r))?(e=e.substring(n.raw.length),r.push(n),!0):!1))continue;if(n=this.tokenizer.space(e)){e=e.substring(n.raw.length);let a=r.at(-1);n.raw.length===1&&a!==void 0?a.raw+=`
`:r.push(n);continue}if(n=this.tokenizer.code(e)){e=e.substring(n.raw.length);let a=r.at(-1);a?.type==="paragraph"||a?.type==="text"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.text,this.inlineQueue.at(-1).src=a.text):r.push(n);continue}if(n=this.tokenizer.fences(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.heading(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.hr(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.blockquote(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.list(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.html(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.def(e)){e=e.substring(n.raw.length);let a=r.at(-1);a?.type==="paragraph"||a?.type==="text"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.raw,this.inlineQueue.at(-1).src=a.text):this.tokens.links[n.tag]||(this.tokens.links[n.tag]={href:n.href,title:n.title},r.push(n));continue}if(n=this.tokenizer.table(e)){e=e.substring(n.raw.length),r.push(n);continue}if(n=this.tokenizer.lheading(e)){e=e.substring(n.raw.length),r.push(n);continue}let s=e;if(this.options.extensions?.startBlock){let a=1/0,d=e.slice(1),i;this.options.extensions.startBlock.forEach(c=>{i=c.call({lexer:this},d),typeof i=="number"&&i>=0&&(a=Math.min(a,i))}),a<1/0&&a>=0&&(s=e.substring(0,a+1))}if(this.state.top&&(n=this.tokenizer.paragraph(s))){let a=r.at(-1);o&&a?.type==="paragraph"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=a.text):r.push(n),o=s.length!==e.length,e=e.substring(n.raw.length);continue}if(n=this.tokenizer.text(e)){e=e.substring(n.raw.length);let a=r.at(-1);a?.type==="text"?(a.raw+=(a.raw.endsWith(`
`)?"":`
`)+n.raw,a.text+=`
`+n.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=a.text):r.push(n);continue}if(e){let a="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(a);break}else throw new Error(a)}}return this.state.top=!0,r}inline(e,r=[]){return this.inlineQueue.push({src:e,tokens:r}),r}inlineTokens(e,r=[]){let o=e,n=null;if(this.tokens.links){let i=Object.keys(this.tokens.links);if(i.length>0)for(;(n=this.tokenizer.rules.inline.reflinkSearch.exec(o))!=null;)i.includes(n[0].slice(n[0].lastIndexOf("[")+1,-1))&&(o=o.slice(0,n.index)+"["+"a".repeat(n[0].length-2)+"]"+o.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(n=this.tokenizer.rules.inline.anyPunctuation.exec(o))!=null;)o=o.slice(0,n.index)+"++"+o.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);let s;for(;(n=this.tokenizer.rules.inline.blockSkip.exec(o))!=null;)s=n[2]?n[2].length:0,o=o.slice(0,n.index+s)+"["+"a".repeat(n[0].length-s-2)+"]"+o.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);o=this.options.hooks?.emStrongMask?.call({lexer:this},o)??o;let a=!1,d="";for(;e;){a||(d=""),a=!1;let i;if(this.options.extensions?.inline?.some(p=>(i=p.call({lexer:this},e,r))?(e=e.substring(i.raw.length),r.push(i),!0):!1))continue;if(i=this.tokenizer.escape(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.tag(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.link(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(i.raw.length);let p=r.at(-1);i.type==="text"&&p?.type==="text"?(p.raw+=i.raw,p.text+=i.text):r.push(i);continue}if(i=this.tokenizer.emStrong(e,o,d)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.codespan(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.br(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.del(e)){e=e.substring(i.raw.length),r.push(i);continue}if(i=this.tokenizer.autolink(e)){e=e.substring(i.raw.length),r.push(i);continue}if(!this.state.inLink&&(i=this.tokenizer.url(e))){e=e.substring(i.raw.length),r.push(i);continue}let c=e;if(this.options.extensions?.startInline){let p=1/0,l=e.slice(1),h;this.options.extensions.startInline.forEach(g=>{h=g.call({lexer:this},l),typeof h=="number"&&h>=0&&(p=Math.min(p,h))}),p<1/0&&p>=0&&(c=e.substring(0,p+1))}if(i=this.tokenizer.inlineText(c)){e=e.substring(i.raw.length),i.raw.slice(-1)!=="_"&&(d=i.raw.slice(-1)),a=!0;let p=r.at(-1);p?.type==="text"?(p.raw+=i.raw,p.text+=i.text):r.push(i);continue}if(e){let p="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(p);break}else throw new Error(p)}}return r}},ve=class{options;parser;constructor(t){this.options=t||O}space(t){return""}code({text:t,lang:e,escaped:r}){let o=(e||"").match(I.notSpaceStart)?.[0],n=t.replace(I.endingNewline,"")+`
`;return o?'<pre><code class="language-'+j(o)+'">'+(r?n:j(n,!0))+`</code></pre>
`:"<pre><code>"+(r?n:j(n,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}def(t){return""}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){let e=t.ordered,r=t.start,o="";for(let a=0;a<t.items.length;a++){let d=t.items[a];o+=this.listitem(d)}let n=e?"ol":"ul",s=e&&r!==1?' start="'+r+'"':"";return"<"+n+s+`>
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
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${j(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:r}){let o=this.parser.parseInline(r),n=Mt(t);if(n===null)return o;t=n;let s='<a href="'+t+'"';return e&&(s+=' title="'+j(e)+'"'),s+=">"+o+"</a>",s}image({href:t,title:e,text:r,tokens:o}){o&&(r=this.parser.parseInline(o,this.parser.textRenderer));let n=Mt(t);if(n===null)return j(r);t=n;let s=`<img src="${t}" alt="${r}"`;return e&&(s+=` title="${j(e)}"`),s+=">",s}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:j(t.text)}},De=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}checkbox({raw:t}){return t}},P=class Ge{options;renderer;textRenderer;constructor(e){this.options=e||O,this.options.renderer=this.options.renderer||new ve,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new De}static parse(e,r){return new Ge(r).parse(e)}static parseInline(e,r){return new Ge(r).parseInline(e)}parse(e){let r="";for(let o=0;o<e.length;o++){let n=e[o];if(this.options.extensions?.renderers?.[n.type]){let a=n,d=this.options.extensions.renderers[a.type].call({parser:this},a);if(d!==!1||!["space","hr","heading","code","table","blockquote","list","html","def","paragraph","text"].includes(a.type)){r+=d||"";continue}}let s=n;switch(s.type){case"space":{r+=this.renderer.space(s);break}case"hr":{r+=this.renderer.hr(s);break}case"heading":{r+=this.renderer.heading(s);break}case"code":{r+=this.renderer.code(s);break}case"table":{r+=this.renderer.table(s);break}case"blockquote":{r+=this.renderer.blockquote(s);break}case"list":{r+=this.renderer.list(s);break}case"checkbox":{r+=this.renderer.checkbox(s);break}case"html":{r+=this.renderer.html(s);break}case"def":{r+=this.renderer.def(s);break}case"paragraph":{r+=this.renderer.paragraph(s);break}case"text":{r+=this.renderer.text(s);break}default:{let a='Token with "'+s.type+'" type was not found.';if(this.options.silent)return console.error(a),"";throw new Error(a)}}}return r}parseInline(e,r=this.renderer){let o="";for(let n=0;n<e.length;n++){let s=e[n];if(this.options.extensions?.renderers?.[s.type]){let d=this.options.extensions.renderers[s.type].call({parser:this},s);if(d!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(s.type)){o+=d||"";continue}}let a=s;switch(a.type){case"escape":{o+=r.text(a);break}case"html":{o+=r.html(a);break}case"link":{o+=r.link(a);break}case"image":{o+=r.image(a);break}case"checkbox":{o+=r.checkbox(a);break}case"strong":{o+=r.strong(a);break}case"em":{o+=r.em(a);break}case"codespan":{o+=r.codespan(a);break}case"br":{o+=r.br(a);break}case"del":{o+=r.del(a);break}case"text":{o+=r.text(a);break}default:{let d='Token with "'+a.type+'" type was not found.';if(this.options.silent)return console.error(d),"";throw new Error(d)}}}return o}},oe=class{options;block;constructor(t){this.options=t||O}static passThroughHooks=new Set(["preprocess","postprocess","processAllTokens","emStrongMask"]);static passThroughHooksRespectAsync=new Set(["preprocess","postprocess","processAllTokens"]);preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}emStrongMask(t){return t}provideLexer(){return this.block?M.lex:M.lexInline}provideParser(){return this.block?P.parse:P.parseInline}},jr=class{defaults=Ne();options=this.setOptions;parse=this.parseMarkdown(!0);parseInline=this.parseMarkdown(!1);Parser=P;Renderer=ve;TextRenderer=De;Lexer=M;Tokenizer=xe;Hooks=oe;constructor(...t){this.use(...t)}walkTokens(t,e){let r=[];for(let o of t)switch(r=r.concat(e.call(this,o)),o.type){case"table":{let n=o;for(let s of n.header)r=r.concat(this.walkTokens(s.tokens,e));for(let s of n.rows)for(let a of s)r=r.concat(this.walkTokens(a.tokens,e));break}case"list":{let n=o;r=r.concat(this.walkTokens(n.items,e));break}default:{let n=o;this.defaults.extensions?.childTokens?.[n.type]?this.defaults.extensions.childTokens[n.type].forEach(s=>{let a=n[s].flat(1/0);r=r.concat(this.walkTokens(a,e))}):n.tokens&&(r=r.concat(this.walkTokens(n.tokens,e)))}}return r}use(...t){let e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(r=>{let o={...r};if(o.async=this.defaults.async||o.async||!1,r.extensions&&(r.extensions.forEach(n=>{if(!n.name)throw new Error("extension name required");if("renderer"in n){let s=e.renderers[n.name];s?e.renderers[n.name]=function(...a){let d=n.renderer.apply(this,a);return d===!1&&(d=s.apply(this,a)),d}:e.renderers[n.name]=n.renderer}if("tokenizer"in n){if(!n.level||n.level!=="block"&&n.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");let s=e[n.level];s?s.unshift(n.tokenizer):e[n.level]=[n.tokenizer],n.start&&(n.level==="block"?e.startBlock?e.startBlock.push(n.start):e.startBlock=[n.start]:n.level==="inline"&&(e.startInline?e.startInline.push(n.start):e.startInline=[n.start]))}"childTokens"in n&&n.childTokens&&(e.childTokens[n.name]=n.childTokens)}),o.extensions=e),r.renderer){let n=this.defaults.renderer||new ve(this.defaults);for(let s in r.renderer){if(!(s in n))throw new Error(`renderer '${s}' does not exist`);if(["options","parser"].includes(s))continue;let a=s,d=r.renderer[a],i=n[a];n[a]=(...c)=>{let p=d.apply(n,c);return p===!1&&(p=i.apply(n,c)),p||""}}o.renderer=n}if(r.tokenizer){let n=this.defaults.tokenizer||new xe(this.defaults);for(let s in r.tokenizer){if(!(s in n))throw new Error(`tokenizer '${s}' does not exist`);if(["options","rules","lexer"].includes(s))continue;let a=s,d=r.tokenizer[a],i=n[a];n[a]=(...c)=>{let p=d.apply(n,c);return p===!1&&(p=i.apply(n,c)),p}}o.tokenizer=n}if(r.hooks){let n=this.defaults.hooks||new oe;for(let s in r.hooks){if(!(s in n))throw new Error(`hook '${s}' does not exist`);if(["options","block"].includes(s))continue;let a=s,d=r.hooks[a],i=n[a];oe.passThroughHooks.has(s)?n[a]=c=>{if(this.defaults.async&&oe.passThroughHooksRespectAsync.has(s))return(async()=>{let l=await d.call(n,c);return i.call(n,l)})();let p=d.call(n,c);return i.call(n,p)}:n[a]=(...c)=>{if(this.defaults.async)return(async()=>{let l=await d.apply(n,c);return l===!1&&(l=await i.apply(n,c)),l})();let p=d.apply(n,c);return p===!1&&(p=i.apply(n,c)),p}}o.hooks=n}if(r.walkTokens){let n=this.defaults.walkTokens,s=r.walkTokens;o.walkTokens=function(a){let d=[];return d.push(s.call(this,a)),n&&(d=d.concat(n.call(this,a))),d}}this.defaults={...this.defaults,...o}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return M.lex(t,e??this.defaults)}parser(t,e){return P.parse(t,e??this.defaults)}parseMarkdown(t){return(e,r)=>{let o={...r},n={...this.defaults,...o},s=this.onError(!!n.silent,!!n.async);if(this.defaults.async===!0&&o.async===!1)return s(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof e>"u"||e===null)return s(new Error("marked(): input parameter is undefined or null"));if(typeof e!="string")return s(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(e)+", string expected"));if(n.hooks&&(n.hooks.options=n,n.hooks.block=t),n.async)return(async()=>{let a=n.hooks?await n.hooks.preprocess(e):e,d=await(n.hooks?await n.hooks.provideLexer():t?M.lex:M.lexInline)(a,n),i=n.hooks?await n.hooks.processAllTokens(d):d;n.walkTokens&&await Promise.all(this.walkTokens(i,n.walkTokens));let c=await(n.hooks?await n.hooks.provideParser():t?P.parse:P.parseInline)(i,n);return n.hooks?await n.hooks.postprocess(c):c})().catch(s);try{n.hooks&&(e=n.hooks.preprocess(e));let a=(n.hooks?n.hooks.provideLexer():t?M.lex:M.lexInline)(e,n);n.hooks&&(a=n.hooks.processAllTokens(a)),n.walkTokens&&this.walkTokens(a,n.walkTokens);let d=(n.hooks?n.hooks.provideParser():t?P.parse:P.parseInline)(a,n);return n.hooks&&(d=n.hooks.postprocess(d)),d}catch(a){return s(a)}}}onError(t,e){return r=>{if(r.message+=`
Please report this to https://github.com/markedjs/marked.`,t){let o="<p>An error occurred:</p><pre>"+j(r.message+"",!0)+"</pre>";return e?Promise.resolve(o):o}if(e)return Promise.reject(r);throw r}}},U=new jr;function k(t,e){return U.parse(t,e)}k.options=k.setOptions=function(t){return U.setOptions(t),k.defaults=U.defaults,wt(k.defaults),k},k.getDefaults=Ne,k.defaults=O,k.use=function(...t){return U.use(...t),k.defaults=U.defaults,wt(k.defaults),k},k.walkTokens=function(t,e){return U.walkTokens(t,e)},k.parseInline=U.parseInline,k.Parser=P,k.parser=P.parse,k.Renderer=ve,k.TextRenderer=De,k.Lexer=M,k.lexer=M.lex,k.Tokenizer=xe,k.Hooks=oe,k.parse=k,k.options,k.setOptions,k.use,k.walkTokens,k.parseInline,P.parse,M.lex;function Wr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:u("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function Ht({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),u("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function Dr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("path",{d:"m5 12 7-7 7 7"}),u("path",{d:"M12 19V5"})]})}function Or({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:u("path",{d:"m6 9 6 6 6-6"})})}function Ft({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:u("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function jt({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),u("path",{d:"M5 3v4"}),u("path",{d:"M19 17v4"}),u("path",{d:"M3 5h4"}),u("path",{d:"M17 19h4"})]})}function Ur({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("polyline",{points:"15 3 21 3 21 9"}),u("polyline",{points:"9 21 3 21 3 15"}),u("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),u("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Zr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("polyline",{points:"4 14 10 14 10 20"}),u("polyline",{points:"20 10 14 10 14 4"}),u("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),u("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Gr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("circle",{cx:"12",cy:"12",r:"10"}),u("path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}),u("path",{d:"M12 17h.01"})]})}function Qr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("path",{d:"M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1"}),u("circle",{cx:"12",cy:"19",r:"0.5",fill:"currentColor"})]})}function Vr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:u("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})})}function Yr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),u("polyline",{points:"14 2 14 8 20 8"})]})}function Xr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("circle",{cx:"11",cy:"11",r:"8"}),u("path",{d:"m21 21-4.3-4.3"})]})}function Kr({className:t}){return u("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[u("path",{d:"M15 3h6v6"}),u("path",{d:"M10 14 21 3"}),u("path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"})]})}k.setOptions({breaks:!0,gfm:!0});const Wt=new k.Renderer;Wt.link=({href:t,title:e,text:r})=>{const o=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${o}>${r}</a>`},k.use({renderer:Wt});function Jr(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function en(t,e){if(!t)return"";let r=t;return r=r.replace(/【[^】]*】/g,""),r=r.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),r=r.replace(/\[Source:[^\]]*\]/gi,""),r=r.replace(/\(Source:[^)]*\)/gi,""),e&&e.length>0?r=r.replace(/\[(\d+)\]/g,(n,s)=>{const a=parseInt(s,10),d=e.find(i=>i.index===a);if(d){const i=(d.title||"").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),c=(d.url||"").replace(/"/g,"&quot;"),p=(d.snippet||"").replace(/"/g,"&quot;").replace(/'/g,"&#39;").slice(0,150),l=d.url?new URL(d.url).hostname:"";return`<span class="grounded-inline-citation" data-index="${a}" data-title="${i}" data-url="${c}" data-snippet="${p}" data-hostname="${l}">${l||"source"}</span>`}return n}):r=r.replace(/\[\d+\]/g,""),k.parse(r,{async:!1})}function tn({message:t}){const[e,r]=N(!1),[o,n]=N(null),s=Y(null),a=t.role==="user",d=t.citations&&t.citations.length>0;return V(()=>{const i=s.current;if(!i)return;const c=h=>{const g=h.target;if(g.classList.contains("grounded-inline-citation")){const f=g.getBoundingClientRect(),x=i.getBoundingClientRect();n({index:parseInt(g.dataset.index||"0",10),title:g.dataset.title||"",url:g.dataset.url||"",snippet:g.dataset.snippet||"",hostname:g.dataset.hostname||"",x:f.left-x.left,y:f.bottom-x.top+4})}},p=h=>{h.target.classList.contains("grounded-inline-citation")&&n(null)},l=h=>{const g=h.target;g.classList.contains("grounded-inline-citation")&&g.dataset.url&&window.open(g.dataset.url,"_blank","noopener,noreferrer")};return i.addEventListener("mouseenter",c,!0),i.addEventListener("mouseleave",p,!0),i.addEventListener("click",l,!0),()=>{i.removeEventListener("mouseenter",c,!0),i.removeEventListener("mouseleave",p,!0),i.removeEventListener("click",l,!0)}},[]),u("div",{className:`grounded-message ${t.role}`,children:[u("div",{ref:s,className:"grounded-message-bubble",dangerouslySetInnerHTML:{__html:a?Jr(t.content):en(t.content,t.citations)}}),t.isStreaming&&u("span",{className:"grounded-cursor"}),o&&u("div",{className:"grounded-citation-card",style:{left:`${o.x}px`,top:`${o.y}px`},onMouseEnter:()=>{},onMouseLeave:()=>n(null),children:[u("div",{className:"grounded-citation-card-header",children:u("span",{className:"grounded-citation-card-hostname",children:o.hostname})}),u("div",{className:"grounded-citation-card-body",children:[o.title&&u("div",{className:"grounded-citation-card-title",children:o.title}),o.url&&u("div",{className:"grounded-citation-card-url",children:o.url}),o.snippet&&u("div",{className:"grounded-citation-card-snippet",children:o.snippet}),o.url&&u("a",{href:o.url,target:"_blank",rel:"noopener noreferrer",className:"grounded-citation-card-link",children:[u(Kr,{}),"Open source"]})]})]}),!a&&d&&u("div",{className:"grounded-sources",children:[u("button",{className:`grounded-sources-trigger ${e?"open":""}`,onClick:()=>r(!e),children:[u(Ft,{}),t.citations.length," source",t.citations.length!==1?"s":"",u(Or,{})]}),u("div",{className:`grounded-sources-list ${e?"open":""}`,children:t.citations.map((i,c)=>{const p=i.url?.startsWith("upload://"),l=i.title||(p?"Uploaded Document":i.url)||`Source ${c+1}`;return p?u("div",{className:"grounded-source grounded-source-file",children:[u(Yr,{}),u("span",{className:"grounded-source-title",children:l})]},c):u("a",{href:i.url||"#",target:"_blank",rel:"noopener noreferrer",className:"grounded-source",children:[u(Ft,{}),u("span",{className:"grounded-source-title",children:l})]},c)})})]})]})}function rn({status:t}){const e=()=>{if(t.message)return t.message;switch(t.status){case"searching":return"Searching knowledge base...";case"generating":return t.sourcesCount?`Found ${t.sourcesCount} relevant sources. Generating...`:"Generating response...";default:return"Thinking..."}};return u("div",{className:"grounded-status",children:u("div",{className:"grounded-status-content",children:[(()=>{switch(t.status){case"searching":return u(Xr,{className:"grounded-status-icon"});case"generating":return u(jt,{className:"grounded-status-icon"});default:return null}})(),u("span",{className:"grounded-status-text",children:e()}),u("div",{className:"grounded-status-dots",children:[u("div",{className:"grounded-typing-dot"}),u("div",{className:"grounded-typing-dot"}),u("div",{className:"grounded-typing-dot"})]})]})})}function Dt({options:t,initialOpen:e=!1,onOpenChange:r}){const{token:o,apiBase:n="",position:s="bottom-right"}=t,[a,d]=N(e),[i,c]=N(!1),[p,l]=N(""),h=Y(null),g=Y(null),{config:f}=or({token:o,apiBase:n}),{messages:x,isLoading:v,chatStatus:b,sendMessage:m}=nr({token:o,apiBase:n});V(()=>{h.current&&h.current.scrollIntoView({behavior:"smooth"})},[x,v]),V(()=>{a&&g.current&&setTimeout(()=>g.current?.focus(),100)},[a]);const A=Y(!1);V(()=>{A.current&&!v&&a&&setTimeout(()=>g.current?.focus(),50),A.current=v},[v,a]),V(()=>{r?.(a)},[a,r]);const $=()=>{d(!a)},y=()=>{p.trim()&&!v&&(m(p),l(""),g.current&&(g.current.style.height="auto"),setTimeout(()=>{g.current?.focus()},50))},T=B=>{B.key==="Enter"&&!B.shiftKey&&(B.preventDefault(),y())},W=B=>{const we=B.target;l(we.value),we.style.height="auto",we.style.height=Math.min(we.scrollHeight,120)+"px"},E=s==="bottom-left",q=f?.agentName||"Assistant",H=f?.welcomeMessage||"How can I help?",L=f?.description||"Ask me anything. I'm here to assist you.",R=f?.logoUrl,Z=x.length===0&&!v,se=f?.theme?.buttonStyle||"circle",ae=f?.theme?.buttonSize||"medium",C=f?.theme?.buttonText||"Chat with us",Ue=f?.theme?.buttonIcon||"chat",ie=f?.theme?.buttonColor||"#2563eb",Ut=f?.theme?.customIconUrl,Zt=f?.theme?.customIconSize,sn=()=>{if(Ut){const B=Zt?{"--custom-icon-size":`${Zt}px`}:void 0;return u("img",{src:Ut,alt:"",className:"grounded-launcher-custom-icon",style:B})}switch(Ue){case"help":return u(Gr,{});case"question":return u(Qr,{});case"message":return u(Vr,{});default:return u(Wr,{})}};return u("div",{className:`grounded-container ${E?"left":""}`,children:[u("div",{className:`grounded-window ${a?"open":""} ${i?"expanded":""}`,children:[u("div",{className:"grounded-header",children:[u("div",{className:"grounded-header-left",children:[R&&u("img",{src:R,alt:"",className:"grounded-header-logo"}),u("h2",{className:"grounded-header-title",children:q})]}),u("div",{className:"grounded-header-actions",children:[u("button",{className:"grounded-header-btn",onClick:()=>c(!i),"aria-label":i?"Shrink chat":"Expand chat",children:i?u(Zr,{}):u(Ur,{})}),u("button",{className:"grounded-header-btn",onClick:$,"aria-label":"Close chat",children:u(Ht,{})})]})]}),u("div",{className:"grounded-messages",children:[Z?u("div",{className:"grounded-empty",children:[u(jt,{className:"grounded-empty-icon"}),u("h3",{className:"grounded-empty-title",children:L}),u("p",{className:"grounded-empty-text",children:H})]}):u(G,{children:[x.filter(B=>B.content||B.role==="user").map(B=>u(tn,{message:B},B.id)),(v||b.status!=="idle")&&b.status!=="streaming"&&u(rn,{status:b})]}),u("div",{ref:h})]}),u("div",{className:"grounded-input-area",children:u("div",{className:"grounded-input-container",children:[u("textarea",{ref:g,className:"grounded-input",placeholder:"Type a message...",value:p,onInput:W,onKeyDown:T,rows:1,disabled:v}),u("button",{className:"grounded-send",onClick:y,disabled:!p.trim()||v,"aria-label":"Send message",children:u(Dr,{})})]})}),u("div",{className:"grounded-footer",children:["Powered by ",u("a",{href:"https://grounded.ai",target:"_blank",rel:"noopener",children:"Grounded"})]})]}),u("button",{className:`grounded-launcher grounded-launcher--${se} grounded-launcher--${ae} ${a?"open":""}`,onClick:$,"aria-label":a?"Close chat":"Open chat",style:{backgroundColor:ie},children:a?u(Ht,{}):u(G,{children:[sn(),se==="pill"&&u("span",{className:"grounded-launcher-text",children:C})]})})]})}const nn=`
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
`;class on{constructor(){this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.processQueue()}processQueue(){const e=window.grounded?.q||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,r){switch(e){case"init":this.init(r);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[Grounded Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[Grounded Widget] Already initialized");return}if(!e?.token){console.error("[Grounded Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase()},this.container=document.createElement("div"),this.container.id="grounded-widget-root",document.body.appendChild(this.container),this.shadowRoot=this.container.attachShadow({mode:"open"});const r=document.createElement("style");r.textContent=nn,this.shadowRoot.appendChild(r);const o=document.createElement("div");this.shadowRoot.appendChild(o),dt(u(Dt,{options:this.options,initialOpen:this.openState,onOpenChange:n=>{this.openState=n,this.openCallback?.(n)}}),o),this.isInitialized=!0,console.log("[Grounded Widget] Initialized")}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const r of e){const o=r.getAttribute("src");if(o)try{return new URL(o,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){if(!this.shadowRoot||!this.options)return;const e=this.shadowRoot.querySelector("div:last-child");e&&dt(u(Dt,{options:this.options,initialOpen:this.openState,onOpenChange:r=>{this.openState=r,this.openCallback?.(r)}}),e)}destroy(){this.container&&this.container.remove(),this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[Grounded Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const Oe=new on;function Ot(t,e){Oe.handleCommand(t,e)}return window.grounded=Ot,window.GroundedWidget=Oe,le.GroundedWidget=Oe,le.grounded=Ot,Object.defineProperty(le,Symbol.toStringTag,{value:"Module"}),le})({});
