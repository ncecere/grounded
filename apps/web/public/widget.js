var KCBWidget=function(q){"use strict";var cr=Object.defineProperty;var ur=(q,N,m)=>N in q?cr(q,N,{enumerable:!0,configurable:!0,writable:!0,value:m}):q[N]=m;var y=(q,N,m)=>ur(q,typeof N!="symbol"?N+"":N,m);var Oe;var N,m,Ke,Z,Ve,Ye,Xe,Je,ye,Se,$e,Y={},et=[],Yt=/acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i,ce=Array.isArray;function j(t,e){for(var n in e)t[n]=e[n];return t}function Ce(t){t&&t.parentNode&&t.parentNode.removeChild(t)}function Xt(t,e,n){var r,i,s,l={};for(s in e)s=="key"?r=e[s]:s=="ref"?i=e[s]:l[s]=e[s];if(arguments.length>2&&(l.children=arguments.length>3?N.call(arguments,2):n),typeof t=="function"&&t.defaultProps!=null)for(s in t.defaultProps)l[s]===void 0&&(l[s]=t.defaultProps[s]);return ue(t,l,r,i,null)}function ue(t,e,n,r,i){var s={type:t,props:e,key:n,ref:r,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:i??++Ke,__i:-1,__u:0};return i==null&&m.vnode!=null&&m.vnode(s),s}function K(t){return t.children}function he(t,e){this.props=t,this.context=e}function V(t,e){if(e==null)return t.__?V(t.__,t.__i+1):null;for(var n;e<t.__k.length;e++)if((n=t.__k[e])!=null&&n.__e!=null)return n.__e;return typeof t.type=="function"?V(t):null}function tt(t){var e,n;if((t=t.__)!=null&&t.__c!=null){for(t.__e=t.__c.base=null,e=0;e<t.__k.length;e++)if((n=t.__k[e])!=null&&n.__e!=null){t.__e=t.__c.base=n.__e;break}return tt(t)}}function nt(t){(!t.__d&&(t.__d=!0)&&Z.push(t)&&!pe.__r++||Ve!=m.debounceRendering)&&((Ve=m.debounceRendering)||Ye)(pe)}function pe(){for(var t,e,n,r,i,s,l,a=1;Z.length;)Z.length>a&&Z.sort(Xe),t=Z.shift(),a=Z.length,t.__d&&(n=void 0,r=void 0,i=(r=(e=t).__v).__e,s=[],l=[],e.__P&&((n=j({},r)).__v=r.__v+1,m.vnode&&m.vnode(n),Re(e.__P,n,r,e.__n,e.__P.namespaceURI,32&r.__u?[i]:null,s,i??V(r),!!(32&r.__u),l),n.__v=r.__v,n.__.__k[n.__i]=n,ot(s,n,l),r.__e=r.__=null,n.__e!=i&&tt(n)));pe.__r=0}function rt(t,e,n,r,i,s,l,a,h,o,c){var u,p,f,b,v,k,_,g=r&&r.__k||et,T=e.length;for(h=Jt(n,e,g,h,T),u=0;u<T;u++)(f=n.__k[u])!=null&&(p=f.__i==-1?Y:g[f.__i]||Y,f.__i=u,k=Re(t,f,p,i,s,l,a,h,o,c),b=f.__e,f.ref&&p.ref!=f.ref&&(p.ref&&Te(p.ref,null,f),c.push(f.ref,f.__c||b,f)),v==null&&b!=null&&(v=b),(_=!!(4&f.__u))||p.__k===f.__k?h=it(f,h,t,_):typeof f.type=="function"&&k!==void 0?h=k:b&&(h=b.nextSibling),f.__u&=-7);return n.__e=v,h}function Jt(t,e,n,r,i){var s,l,a,h,o,c=n.length,u=c,p=0;for(t.__k=new Array(i),s=0;s<i;s++)(l=e[s])!=null&&typeof l!="boolean"&&typeof l!="function"?(typeof l=="string"||typeof l=="number"||typeof l=="bigint"||l.constructor==String?l=t.__k[s]=ue(null,l,null,null,null):ce(l)?l=t.__k[s]=ue(K,{children:l},null,null,null):l.constructor===void 0&&l.__b>0?l=t.__k[s]=ue(l.type,l.props,l.key,l.ref?l.ref:null,l.__v):t.__k[s]=l,h=s+p,l.__=t,l.__b=t.__b+1,a=null,(o=l.__i=en(l,n,h,u))!=-1&&(u--,(a=n[o])&&(a.__u|=2)),a==null||a.__v==null?(o==-1&&(i>c?p--:i<c&&p++),typeof l.type!="function"&&(l.__u|=4)):o!=h&&(o==h-1?p--:o==h+1?p++:(o>h?p--:p++,l.__u|=4))):t.__k[s]=null;if(u)for(s=0;s<c;s++)(a=n[s])!=null&&!(2&a.__u)&&(a.__e==r&&(r=V(a)),ct(a,a));return r}function it(t,e,n,r){var i,s;if(typeof t.type=="function"){for(i=t.__k,s=0;i&&s<i.length;s++)i[s]&&(i[s].__=t,e=it(i[s],e,n,r));return e}t.__e!=e&&(r&&(e&&t.type&&!e.parentNode&&(e=V(t)),n.insertBefore(t.__e,e||null)),e=t.__e);do e=e&&e.nextSibling;while(e!=null&&e.nodeType==8);return e}function en(t,e,n,r){var i,s,l,a=t.key,h=t.type,o=e[n],c=o!=null&&(2&o.__u)==0;if(o===null&&a==null||c&&a==o.key&&h==o.type)return n;if(r>(c?1:0)){for(i=n-1,s=n+1;i>=0||s<e.length;)if((o=e[l=i>=0?i--:s++])!=null&&!(2&o.__u)&&a==o.key&&h==o.type)return l}return-1}function st(t,e,n){e[0]=="-"?t.setProperty(e,n??""):t[e]=n==null?"":typeof n!="number"||Yt.test(e)?n:n+"px"}function de(t,e,n,r,i){var s,l;e:if(e=="style")if(typeof n=="string")t.style.cssText=n;else{if(typeof r=="string"&&(t.style.cssText=r=""),r)for(e in r)n&&e in n||st(t.style,e,"");if(n)for(e in n)r&&n[e]==r[e]||st(t.style,e,n[e])}else if(e[0]=="o"&&e[1]=="n")s=e!=(e=e.replace(Je,"$1")),l=e.toLowerCase(),e=l in t||e=="onFocusOut"||e=="onFocusIn"?l.slice(2):e.slice(2),t.l||(t.l={}),t.l[e+s]=n,n?r?n.u=r.u:(n.u=ye,t.addEventListener(e,s?$e:Se,s)):t.removeEventListener(e,s?$e:Se,s);else{if(i=="http://www.w3.org/2000/svg")e=e.replace(/xlink(H|:h)/,"h").replace(/sName$/,"s");else if(e!="width"&&e!="height"&&e!="href"&&e!="list"&&e!="form"&&e!="tabIndex"&&e!="download"&&e!="rowSpan"&&e!="colSpan"&&e!="role"&&e!="popover"&&e in t)try{t[e]=n??"";break e}catch{}typeof n=="function"||(n==null||n===!1&&e[4]!="-"?t.removeAttribute(e):t.setAttribute(e,e=="popover"&&n==1?"":n))}}function at(t){return function(e){if(this.l){var n=this.l[e.type+t];if(e.t==null)e.t=ye++;else if(e.t<n.u)return;return n(m.event?m.event(e):e)}}}function Re(t,e,n,r,i,s,l,a,h,o){var c,u,p,f,b,v,k,_,g,T,S,I,B,z,D,F,O,C=e.type;if(e.constructor!==void 0)return null;128&n.__u&&(h=!!(32&n.__u),s=[a=e.__e=n.__e]),(c=m.__b)&&c(e);e:if(typeof C=="function")try{if(_=e.props,g="prototype"in C&&C.prototype.render,T=(c=C.contextType)&&r[c.__c],S=c?T?T.props.value:c.__:r,n.__c?k=(u=e.__c=n.__c).__=u.__E:(g?e.__c=u=new C(_,S):(e.__c=u=new he(_,S),u.constructor=C,u.render=nn),T&&T.sub(u),u.state||(u.state={}),u.__n=r,p=u.__d=!0,u.__h=[],u._sb=[]),g&&u.__s==null&&(u.__s=u.state),g&&C.getDerivedStateFromProps!=null&&(u.__s==u.state&&(u.__s=j({},u.__s)),j(u.__s,C.getDerivedStateFromProps(_,u.__s))),f=u.props,b=u.state,u.__v=e,p)g&&C.getDerivedStateFromProps==null&&u.componentWillMount!=null&&u.componentWillMount(),g&&u.componentDidMount!=null&&u.__h.push(u.componentDidMount);else{if(g&&C.getDerivedStateFromProps==null&&_!==f&&u.componentWillReceiveProps!=null&&u.componentWillReceiveProps(_,S),e.__v==n.__v||!u.__e&&u.shouldComponentUpdate!=null&&u.shouldComponentUpdate(_,u.__s,S)===!1){for(e.__v!=n.__v&&(u.props=_,u.state=u.__s,u.__d=!1),e.__e=n.__e,e.__k=n.__k,e.__k.some(function(E){E&&(E.__=e)}),I=0;I<u._sb.length;I++)u.__h.push(u._sb[I]);u._sb=[],u.__h.length&&l.push(u);break e}u.componentWillUpdate!=null&&u.componentWillUpdate(_,u.__s,S),g&&u.componentDidUpdate!=null&&u.__h.push(function(){u.componentDidUpdate(f,b,v)})}if(u.context=S,u.props=_,u.__P=t,u.__e=!1,B=m.__r,z=0,g){for(u.state=u.__s,u.__d=!1,B&&B(e),c=u.render(u.props,u.state,u.context),D=0;D<u._sb.length;D++)u.__h.push(u._sb[D]);u._sb=[]}else do u.__d=!1,B&&B(e),c=u.render(u.props,u.state,u.context),u.state=u.__s;while(u.__d&&++z<25);u.state=u.__s,u.getChildContext!=null&&(r=j(j({},r),u.getChildContext())),g&&!p&&u.getSnapshotBeforeUpdate!=null&&(v=u.getSnapshotBeforeUpdate(f,b)),F=c,c!=null&&c.type===K&&c.key==null&&(F=lt(c.props.children)),a=rt(t,ce(F)?F:[F],e,n,r,i,s,l,a,h,o),u.base=e.__e,e.__u&=-161,u.__h.length&&l.push(u),k&&(u.__E=u.__=null)}catch(E){if(e.__v=null,h||s!=null)if(E.then){for(e.__u|=h?160:128;a&&a.nodeType==8&&a.nextSibling;)a=a.nextSibling;s[s.indexOf(a)]=null,e.__e=a}else{for(O=s.length;O--;)Ce(s[O]);ze(e)}else e.__e=n.__e,e.__k=n.__k,E.then||ze(e);m.__e(E,e,n)}else s==null&&e.__v==n.__v?(e.__k=n.__k,e.__e=n.__e):a=e.__e=tn(n.__e,e,n,r,i,s,l,h,o);return(c=m.diffed)&&c(e),128&e.__u?void 0:a}function ze(t){t&&t.__c&&(t.__c.__e=!0),t&&t.__k&&t.__k.forEach(ze)}function ot(t,e,n){for(var r=0;r<n.length;r++)Te(n[r],n[++r],n[++r]);m.__c&&m.__c(e,t),t.some(function(i){try{t=i.__h,i.__h=[],t.some(function(s){s.call(i)})}catch(s){m.__e(s,i.__v)}})}function lt(t){return typeof t!="object"||t==null||t.__b&&t.__b>0?t:ce(t)?t.map(lt):j({},t)}function tn(t,e,n,r,i,s,l,a,h){var o,c,u,p,f,b,v,k=n.props||Y,_=e.props,g=e.type;if(g=="svg"?i="http://www.w3.org/2000/svg":g=="math"?i="http://www.w3.org/1998/Math/MathML":i||(i="http://www.w3.org/1999/xhtml"),s!=null){for(o=0;o<s.length;o++)if((f=s[o])&&"setAttribute"in f==!!g&&(g?f.localName==g:f.nodeType==3)){t=f,s[o]=null;break}}if(t==null){if(g==null)return document.createTextNode(_);t=document.createElementNS(i,g,_.is&&_),a&&(m.__m&&m.__m(e,s),a=!1),s=null}if(g==null)k===_||a&&t.data==_||(t.data=_);else{if(s=s&&N.call(t.childNodes),!a&&s!=null)for(k={},o=0;o<t.attributes.length;o++)k[(f=t.attributes[o]).name]=f.value;for(o in k)if(f=k[o],o!="children"){if(o=="dangerouslySetInnerHTML")u=f;else if(!(o in _)){if(o=="value"&&"defaultValue"in _||o=="checked"&&"defaultChecked"in _)continue;de(t,o,null,f,i)}}for(o in _)f=_[o],o=="children"?p=f:o=="dangerouslySetInnerHTML"?c=f:o=="value"?b=f:o=="checked"?v=f:a&&typeof f!="function"||k[o]===f||de(t,o,f,k[o],i);if(c)a||u&&(c.__html==u.__html||c.__html==t.innerHTML)||(t.innerHTML=c.__html),e.__k=[];else if(u&&(t.innerHTML=""),rt(e.type=="template"?t.content:t,ce(p)?p:[p],e,n,r,g=="foreignObject"?"http://www.w3.org/1999/xhtml":i,s,l,s?s[0]:n.__k&&V(n,0),a,h),s!=null)for(o=s.length;o--;)Ce(s[o]);a||(o="value",g=="progress"&&b==null?t.removeAttribute("value"):b!=null&&(b!==t[o]||g=="progress"&&!b||g=="option"&&b!=k[o])&&de(t,o,b,k[o],i),o="checked",v!=null&&v!=t[o]&&de(t,o,v,k[o],i))}return t}function Te(t,e,n){try{if(typeof t=="function"){var r=typeof t.__u=="function";r&&t.__u(),r&&e==null||(t.__u=t(e))}else t.current=e}catch(i){m.__e(i,n)}}function ct(t,e,n){var r,i;if(m.unmount&&m.unmount(t),(r=t.ref)&&(r.current&&r.current!=t.__e||Te(r,null,e)),(r=t.__c)!=null){if(r.componentWillUnmount)try{r.componentWillUnmount()}catch(s){m.__e(s,e)}r.base=r.__P=null}if(r=t.__k)for(i=0;i<r.length;i++)r[i]&&ct(r[i],e,n||typeof t.type!="function");n||Ce(t.__e),t.__c=t.__=t.__e=void 0}function nn(t,e,n){return this.constructor(t,n)}function ut(t,e,n){var r,i,s,l;e==document&&(e=document.documentElement),m.__&&m.__(t,e),i=(r=!1)?null:e.__k,s=[],l=[],Re(e,t=e.__k=Xt(K,null,[t]),i||Y,Y,e.namespaceURI,i?null:e.firstChild?N.call(e.childNodes):null,s,i?i.__e:e.firstChild,r,l),ot(s,t,l)}N=et.slice,m={__e:function(t,e,n,r){for(var i,s,l;e=e.__;)if((i=e.__c)&&!i.__)try{if((s=i.constructor)&&s.getDerivedStateFromError!=null&&(i.setState(s.getDerivedStateFromError(t)),l=i.__d),i.componentDidCatch!=null&&(i.componentDidCatch(t,r||{}),l=i.__d),l)return i.__E=i}catch(a){t=a}throw t}},Ke=0,he.prototype.setState=function(t,e){var n;n=this.__s!=null&&this.__s!=this.state?this.__s:this.__s=j({},this.state),typeof t=="function"&&(t=t(j({},n),this.props)),t&&j(n,t),t!=null&&this.__v&&(e&&this._sb.push(e),nt(this))},he.prototype.forceUpdate=function(t){this.__v&&(this.__e=!0,t&&this.__h.push(t),nt(this))},he.prototype.render=K,Z=[],Ye=typeof Promise=="function"?Promise.prototype.then.bind(Promise.resolve()):setTimeout,Xe=function(t,e){return t.__v.__b-e.__v.__b},pe.__r=0,Je=/(PointerCapture)$|Capture$/i,ye=0,Se=at(!1),$e=at(!0);var rn=0;function d(t,e,n,r,i,s){e||(e={});var l,a,h=e;if("ref"in h)for(a in h={},e)a=="ref"?l=e[a]:h[a]=e[a];var o={type:t,props:h,key:n,ref:l,__k:null,__:null,__b:0,__e:null,__c:null,constructor:void 0,__v:--rn,__i:-1,__u:0,__source:i,__self:s};if(typeof t=="function"&&(l=t.defaultProps))for(a in l)h[a]===void 0&&(h[a]=l[a]);return m.vnode&&m.vnode(o),o}var X,$,Ie,ht,J=0,pt=[],R=m,dt=R.__b,bt=R.__r,ft=R.diffed,gt=R.__c,kt=R.unmount,_t=R.__;function Le(t,e){R.__h&&R.__h($,t,J||e),J=0;var n=$.__H||($.__H={__:[],__h:[]});return t>=n.__.length&&n.__.push({}),n.__[t]}function M(t){return J=1,sn(wt,t)}function sn(t,e,n){var r=Le(X++,2);if(r.t=t,!r.__c&&(r.__=[wt(void 0,e),function(a){var h=r.__N?r.__N[0]:r.__[0],o=r.t(h,a);h!==o&&(r.__N=[o,r.__[1]],r.__c.setState({}))}],r.__c=$,!$.__f)){var i=function(a,h,o){if(!r.__c.__H)return!0;var c=r.__c.__H.__.filter(function(p){return!!p.__c});if(c.every(function(p){return!p.__N}))return!s||s.call(this,a,h,o);var u=r.__c.props!==a;return c.forEach(function(p){if(p.__N){var f=p.__[0];p.__=p.__N,p.__N=void 0,f!==p.__[0]&&(u=!0)}}),s&&s.call(this,a,h,o)||u};$.__f=!0;var s=$.shouldComponentUpdate,l=$.componentWillUpdate;$.componentWillUpdate=function(a,h,o){if(this.__e){var c=s;s=void 0,i(a,h,o),s=c}l&&l.call(this,a,h,o)},$.shouldComponentUpdate=i}return r.__N||r.__}function ee(t,e){var n=Le(X++,3);!R.__s&&vt(n.__H,e)&&(n.__=t,n.u=e,$.__H.__h.push(n))}function te(t){return J=5,mt(function(){return{current:t}},[])}function mt(t,e){var n=Le(X++,7);return vt(n.__H,e)&&(n.__=t(),n.__H=e,n.__h=t),n.__}function Ae(t,e){return J=8,mt(function(){return t},e)}function an(){for(var t;t=pt.shift();)if(t.__P&&t.__H)try{t.__H.__h.forEach(be),t.__H.__h.forEach(Be),t.__H.__h=[]}catch(e){t.__H.__h=[],R.__e(e,t.__v)}}R.__b=function(t){$=null,dt&&dt(t)},R.__=function(t,e){t&&e.__k&&e.__k.__m&&(t.__m=e.__k.__m),_t&&_t(t,e)},R.__r=function(t){bt&&bt(t),X=0;var e=($=t.__c).__H;e&&(Ie===$?(e.__h=[],$.__h=[],e.__.forEach(function(n){n.__N&&(n.__=n.__N),n.u=n.__N=void 0})):(e.__h.forEach(be),e.__h.forEach(Be),e.__h=[],X=0)),Ie=$},R.diffed=function(t){ft&&ft(t);var e=t.__c;e&&e.__H&&(e.__H.__h.length&&(pt.push(e)!==1&&ht===R.requestAnimationFrame||((ht=R.requestAnimationFrame)||on)(an)),e.__H.__.forEach(function(n){n.u&&(n.__H=n.u),n.u=void 0})),Ie=$=null},R.__c=function(t,e){e.some(function(n){try{n.__h.forEach(be),n.__h=n.__h.filter(function(r){return!r.__||Be(r)})}catch(r){e.some(function(i){i.__h&&(i.__h=[])}),e=[],R.__e(r,n.__v)}}),gt&&gt(t,e)},R.unmount=function(t){kt&&kt(t);var e,n=t.__c;n&&n.__H&&(n.__H.__.forEach(function(r){try{be(r)}catch(i){e=i}}),n.__H=void 0,e&&R.__e(e,n.__v))};var xt=typeof requestAnimationFrame=="function";function on(t){var e,n=function(){clearTimeout(r),xt&&cancelAnimationFrame(e),setTimeout(t)},r=setTimeout(n,35);xt&&(e=requestAnimationFrame(n))}function be(t){var e=$,n=t.__c;typeof n=="function"&&(t.__c=void 0,n()),$=e}function Be(t){var e=$;t.__c=t.__(),$=e}function vt(t,e){return!t||t.length!==e.length||e.some(function(n,r){return n!==t[r]})}function wt(t,e){return typeof e=="function"?e(t):e}function ln({token:t,apiBase:e}){const[n,r]=M([]),[i,s]=M(!1),[l,a]=M(!1),[h,o]=M(null),c=te(typeof sessionStorage<"u"?sessionStorage.getItem(`kcb_conv_${t}`):null),u=te(null),p=()=>Math.random().toString(36).slice(2,11),f=Ae(async k=>{var T;if(!k.trim()||i||l)return;const _={id:p(),role:"user",content:k.trim(),timestamp:Date.now()},g=p();r(S=>[...S,_]),s(!0),a(!0),o(null),u.current=new AbortController;try{const S={message:k.trim()};c.current&&(S.conversationId=c.current);const I=await fetch(`${e}/api/v1/widget/${t}/chat/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(S),signal:u.current.signal});if(!I.ok){const C=await I.json().catch(()=>({}));throw new Error(C.message||`Request failed: ${I.status}`)}r(C=>[...C,{id:g,role:"assistant",content:"",isStreaming:!0,timestamp:Date.now()}]),s(!1);const B=(T=I.body)==null?void 0:T.getReader();if(!B)throw new Error("No response body");const z=new TextDecoder;let D="",F="",O=[];for(;;){const{done:C,value:E}=await B.read();if(C)break;D+=z.decode(E,{stream:!0});const ae=D.split(`
`);D=ae.pop()||"";for(const oe of ae)if(oe.startsWith("data: "))try{const P=JSON.parse(oe.slice(6));if(P.type==="text"&&P.content)F+=P.content,r(Ze=>Ze.map(le=>le.id===g?{...le,content:F}:le));else if(P.type==="done"){if(P.conversationId){c.current=P.conversationId;try{sessionStorage.setItem(`kcb_conv_${t}`,P.conversationId)}catch{}}O=P.citations||[]}else if(P.type==="error")throw new Error(P.message||"Stream error")}catch{console.warn("[KCB Widget] Failed to parse SSE:",oe)}}r(C=>C.map(E=>E.id===g?{...E,content:F,isStreaming:!1,citations:O}:E))}catch(S){if(S.name==="AbortError")return;o(S instanceof Error?S.message:"An error occurred"),r(I=>I.some(z=>z.id===g)?I.map(z=>z.id===g?{...z,content:"Sorry, something went wrong. Please try again.",isStreaming:!1}:z):[...I,{id:g,role:"assistant",content:"Sorry, something went wrong. Please try again.",timestamp:Date.now()}])}finally{s(!1),a(!1),u.current=null}},[t,e,i,l]),b=Ae(()=>{u.current&&(u.current.abort(),u.current=null),a(!1),s(!1)},[]),v=Ae(()=>{r([]),c.current=null;try{sessionStorage.removeItem(`kcb_conv_${t}`)}catch{}},[t]);return{messages:n,isLoading:i,isStreaming:l,error:h,sendMessage:f,stopStreaming:b,clearMessages:v}}function cn({token:t,apiBase:e}){const[n,r]=M(null),[i,s]=M(!0),[l,a]=M(null);return ee(()=>{async function h(){try{const o=await fetch(`${e}/api/v1/widget/${t}/config`);if(!o.ok)throw new Error("Failed to load widget configuration");const c=await o.json();r(c)}catch(o){a(o instanceof Error?o.message:"Configuration error"),r({agentName:"Assistant",description:"Ask me anything. I'm here to assist you.",welcomeMessage:"How can I help?",logoUrl:null,isPublic:!0})}finally{s(!1)}}h()},[t,e]),{config:n,isLoading:i,error:l}}function Ee(){return{async:!1,breaks:!1,extensions:null,gfm:!0,hooks:null,pedantic:!1,renderer:null,silent:!1,tokenizer:null,walkTokens:null}}var G=Ee();function yt(t){G=t}var ne={exec:()=>null};function w(t,e=""){let n=typeof t=="string"?t:t.source;const r={replace:(i,s)=>{let l=typeof s=="string"?s:s.source;return l=l.replace(A.caret,"$1"),n=n.replace(i,l),r},getRegex:()=>new RegExp(n,e)};return r}var A={codeRemoveIndent:/^(?: {1,4}| {0,3}\t)/gm,outputLinkReplace:/\\([\[\]])/g,indentCodeCompensation:/^(\s+)(?:```)/,beginningSpace:/^\s+/,endingHash:/#$/,startingSpaceChar:/^ /,endingSpaceChar:/ $/,nonSpaceChar:/[^ ]/,newLineCharGlobal:/\n/g,tabCharGlobal:/\t/g,multipleSpaceGlobal:/\s+/g,blankLine:/^[ \t]*$/,doubleBlankLine:/\n[ \t]*\n[ \t]*$/,blockquoteStart:/^ {0,3}>/,blockquoteSetextReplace:/\n {0,3}((?:=+|-+) *)(?=\n|$)/g,blockquoteSetextReplace2:/^ {0,3}>[ \t]?/gm,listReplaceTabs:/^\t+/,listReplaceNesting:/^ {1,4}(?=( {4})*[^ ])/g,listIsTask:/^\[[ xX]\] /,listReplaceTask:/^\[[ xX]\] +/,anyLine:/\n.*\n/,hrefBrackets:/^<(.*)>$/,tableDelimiter:/[:|]/,tableAlignChars:/^\||\| *$/g,tableRowBlankLine:/\n[ \t]*$/,tableAlignRight:/^ *-+: *$/,tableAlignCenter:/^ *:-+: *$/,tableAlignLeft:/^ *:-+ *$/,startATag:/^<a /i,endATag:/^<\/a>/i,startPreScriptTag:/^<(pre|code|kbd|script)(\s|>)/i,endPreScriptTag:/^<\/(pre|code|kbd|script)(\s|>)/i,startAngleBracket:/^</,endAngleBracket:/>$/,pedanticHrefTitle:/^([^'"]*[^\s])\s+(['"])(.*)\2/,unicodeAlphaNumeric:/[\p{L}\p{N}]/u,escapeTest:/[&<>"']/,escapeReplace:/[&<>"']/g,escapeTestNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,escapeReplaceNoEncode:/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,unescapeTest:/&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig,caret:/(^|[^\[])\^/g,percentDecode:/%25/g,findPipe:/\|/g,splitPipe:/ \|/,slashPipe:/\\\|/g,carriageReturn:/\r\n|\r/g,spaceLine:/^ +$/gm,notSpaceStart:/^\S*/,endingNewline:/\n$/,listItemRegex:t=>new RegExp(`^( {0,3}${t})((?:[	 ][^\\n]*)?(?:\\n|$))`),nextBulletRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`),hrRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`),fencesBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}(?:\`\`\`|~~~)`),headingBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}#`),htmlBeginRegex:t=>new RegExp(`^ {0,${Math.min(3,t-1)}}<(?:[a-z].*>|!--)`,"i")},un=/^(?:[ \t]*(?:\n|$))+/,hn=/^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,pn=/^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/,re=/^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,dn=/^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,Pe=/(?:[*+-]|\d{1,9}[.)])/,St=/^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/,$t=w(St).replace(/bull/g,Pe).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/\|table/g,"").getRegex(),bn=w(St).replace(/bull/g,Pe).replace(/blockCode/g,/(?: {4}| {0,3}\t)/).replace(/fences/g,/ {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g,/ {0,3}>/).replace(/heading/g,/ {0,3}#{1,6}/).replace(/html/g,/ {0,3}<[^\n>]+>\n/).replace(/table/g,/ {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex(),Ne=/^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/,fn=/^[^\n]+/,Me=/(?!\s*\])(?:\\.|[^\[\]\\])+/,gn=w(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label",Me).replace("title",/(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex(),kn=w(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g,Pe).getRegex(),fe="address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul",Fe=/<!--(?:-?>|[\s\S]*?(?:-->|$))/,_n=w("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))","i").replace("comment",Fe).replace("tag",fe).replace("attribute",/ +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex(),Ct=w(Ne).replace("hr",re).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("|table","").replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",fe).getRegex(),mn=w(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph",Ct).getRegex(),qe={blockquote:mn,code:hn,def:gn,fences:pn,heading:dn,hr:re,html:_n,lheading:$t,list:kn,newline:un,paragraph:Ct,table:ne,text:fn},Rt=w("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr",re).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("blockquote"," {0,3}>").replace("code","(?: {4}| {0,3}	)[^\\n]").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",fe).getRegex(),xn={...qe,lheading:bn,table:Rt,paragraph:w(Ne).replace("hr",re).replace("heading"," {0,3}#{1,6}(?:\\s|$)").replace("|lheading","").replace("table",Rt).replace("blockquote"," {0,3}>").replace("fences"," {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list"," {0,3}(?:[*+-]|1[.)]) ").replace("html","</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag",fe).getRegex()},vn={...qe,html:w(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment",Fe).replace(/tag/g,"(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,heading:/^(#{1,6})(.*)(?:\n+|$)/,fences:ne,lheading:/^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,paragraph:w(Ne).replace("hr",re).replace("heading",` *#{1,6} *[^
]`).replace("lheading",$t).replace("|table","").replace("blockquote"," {0,3}>").replace("|fences","").replace("|list","").replace("|html","").replace("|tag","").getRegex()},wn=/^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,yn=/^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,zt=/^( {2,}|\\)\n(?!\s*$)/,Sn=/^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/,ge=/[\p{P}\p{S}]/u,He=/[\s\p{P}\p{S}]/u,Tt=/[^\s\p{P}\p{S}]/u,$n=w(/^((?![*_])punctSpace)/,"u").replace(/punctSpace/g,He).getRegex(),It=/(?!~)[\p{P}\p{S}]/u,Cn=/(?!~)[\s\p{P}\p{S}]/u,Rn=/(?:[^\s\p{P}\p{S}]|~)/u,zn=/\[[^[\]]*?\]\((?:\\.|[^\\\(\)]|\((?:\\.|[^\\\(\)])*\))*\)|`[^`]*?`|<[^<>]*?>/g,Lt=/^(?:\*+(?:((?!\*)punct)|[^\s*]))|^_+(?:((?!_)punct)|([^\s_]))/,Tn=w(Lt,"u").replace(/punct/g,ge).getRegex(),In=w(Lt,"u").replace(/punct/g,It).getRegex(),At="^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)",Ln=w(At,"gu").replace(/notPunctSpace/g,Tt).replace(/punctSpace/g,He).replace(/punct/g,ge).getRegex(),An=w(At,"gu").replace(/notPunctSpace/g,Rn).replace(/punctSpace/g,Cn).replace(/punct/g,It).getRegex(),Bn=w("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)","gu").replace(/notPunctSpace/g,Tt).replace(/punctSpace/g,He).replace(/punct/g,ge).getRegex(),En=w(/\\(punct)/,"gu").replace(/punct/g,ge).getRegex(),Pn=w(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme",/[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email",/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex(),Nn=w(Fe).replace("(?:-->|$)","-->").getRegex(),Mn=w("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment",Nn).replace("attribute",/\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex(),ke=/(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/,Fn=w(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]*(?:\n[ \t]*)?)(title))?\s*\)/).replace("label",ke).replace("href",/<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title",/"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex(),Bt=w(/^!?\[(label)\]\[(ref)\]/).replace("label",ke).replace("ref",Me).getRegex(),Et=w(/^!?\[(ref)\](?:\[\])?/).replace("ref",Me).getRegex(),qn=w("reflink|nolink(?!\\()","g").replace("reflink",Bt).replace("nolink",Et).getRegex(),De={_backpedal:ne,anyPunctuation:En,autolink:Pn,blockSkip:zn,br:zt,code:yn,del:ne,emStrongLDelim:Tn,emStrongRDelimAst:Ln,emStrongRDelimUnd:Bn,escape:wn,link:Fn,nolink:Et,punctuation:$n,reflink:Bt,reflinkSearch:qn,tag:Mn,text:Sn,url:ne},Hn={...De,link:w(/^!?\[(label)\]\((.*?)\)/).replace("label",ke).getRegex(),reflink:w(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label",ke).getRegex()},je={...De,emStrongRDelimAst:An,emStrongLDelim:In,url:w(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/,"i").replace("email",/[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),_backpedal:/(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,del:/^(~~?)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/,text:/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/},Dn={...je,br:w(zt).replace("{2,}","*").getRegex(),text:w(je.text).replace("\\b_","\\b_| {2,}\\n").replace(/\{2,\}/g,"*").getRegex()},_e={normal:qe,gfm:xn,pedantic:vn},ie={normal:De,gfm:je,breaks:Dn,pedantic:Hn},jn={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},Pt=t=>jn[t];function H(t,e){if(e){if(A.escapeTest.test(t))return t.replace(A.escapeReplace,Pt)}else if(A.escapeTestNoEncode.test(t))return t.replace(A.escapeReplaceNoEncode,Pt);return t}function Nt(t){try{t=encodeURI(t).replace(A.percentDecode,"%")}catch{return null}return t}function Mt(t,e){var s;const n=t.replace(A.findPipe,(l,a,h)=>{let o=!1,c=a;for(;--c>=0&&h[c]==="\\";)o=!o;return o?"|":" |"}),r=n.split(A.splitPipe);let i=0;if(r[0].trim()||r.shift(),r.length>0&&!((s=r.at(-1))!=null&&s.trim())&&r.pop(),e)if(r.length>e)r.splice(e);else for(;r.length<e;)r.push("");for(;i<r.length;i++)r[i]=r[i].trim().replace(A.slashPipe,"|");return r}function se(t,e,n){const r=t.length;if(r===0)return"";let i=0;for(;i<r&&t.charAt(r-i-1)===e;)i++;return t.slice(0,r-i)}function Wn(t,e){if(t.indexOf(e[1])===-1)return-1;let n=0;for(let r=0;r<t.length;r++)if(t[r]==="\\")r++;else if(t[r]===e[0])n++;else if(t[r]===e[1]&&(n--,n<0))return r;return n>0?-2:-1}function Ft(t,e,n,r,i){const s=e.href,l=e.title||null,a=t[1].replace(i.other.outputLinkReplace,"$1");r.state.inLink=!0;const h={type:t[0].charAt(0)==="!"?"image":"link",raw:n,href:s,title:l,text:a,tokens:r.inlineTokens(a)};return r.state.inLink=!1,h}function Un(t,e,n){const r=t.match(n.other.indentCodeCompensation);if(r===null)return e;const i=r[1];return e.split(`
`).map(s=>{const l=s.match(n.other.beginningSpace);if(l===null)return s;const[a]=l;return a.length>=i.length?s.slice(i.length):s}).join(`
`)}var me=class{constructor(t){y(this,"options");y(this,"rules");y(this,"lexer");this.options=t||G}space(t){const e=this.rules.block.newline.exec(t);if(e&&e[0].length>0)return{type:"space",raw:e[0]}}code(t){const e=this.rules.block.code.exec(t);if(e){const n=e[0].replace(this.rules.other.codeRemoveIndent,"");return{type:"code",raw:e[0],codeBlockStyle:"indented",text:this.options.pedantic?n:se(n,`
`)}}}fences(t){const e=this.rules.block.fences.exec(t);if(e){const n=e[0],r=Un(n,e[3]||"",this.rules);return{type:"code",raw:n,lang:e[2]?e[2].trim().replace(this.rules.inline.anyPunctuation,"$1"):e[2],text:r}}}heading(t){const e=this.rules.block.heading.exec(t);if(e){let n=e[2].trim();if(this.rules.other.endingHash.test(n)){const r=se(n,"#");(this.options.pedantic||!r||this.rules.other.endingSpaceChar.test(r))&&(n=r.trim())}return{type:"heading",raw:e[0],depth:e[1].length,text:n,tokens:this.lexer.inline(n)}}}hr(t){const e=this.rules.block.hr.exec(t);if(e)return{type:"hr",raw:se(e[0],`
`)}}blockquote(t){const e=this.rules.block.blockquote.exec(t);if(e){let n=se(e[0],`
`).split(`
`),r="",i="";const s=[];for(;n.length>0;){let l=!1;const a=[];let h;for(h=0;h<n.length;h++)if(this.rules.other.blockquoteStart.test(n[h]))a.push(n[h]),l=!0;else if(!l)a.push(n[h]);else break;n=n.slice(h);const o=a.join(`
`),c=o.replace(this.rules.other.blockquoteSetextReplace,`
    $1`).replace(this.rules.other.blockquoteSetextReplace2,"");r=r?`${r}
${o}`:o,i=i?`${i}
${c}`:c;const u=this.lexer.state.top;if(this.lexer.state.top=!0,this.lexer.blockTokens(c,s,!0),this.lexer.state.top=u,n.length===0)break;const p=s.at(-1);if((p==null?void 0:p.type)==="code")break;if((p==null?void 0:p.type)==="blockquote"){const f=p,b=f.raw+`
`+n.join(`
`),v=this.blockquote(b);s[s.length-1]=v,r=r.substring(0,r.length-f.raw.length)+v.raw,i=i.substring(0,i.length-f.text.length)+v.text;break}else if((p==null?void 0:p.type)==="list"){const f=p,b=f.raw+`
`+n.join(`
`),v=this.list(b);s[s.length-1]=v,r=r.substring(0,r.length-p.raw.length)+v.raw,i=i.substring(0,i.length-f.raw.length)+v.raw,n=b.substring(s.at(-1).raw.length).split(`
`);continue}}return{type:"blockquote",raw:r,tokens:s,text:i}}}list(t){let e=this.rules.block.list.exec(t);if(e){let n=e[1].trim();const r=n.length>1,i={type:"list",raw:"",ordered:r,start:r?+n.slice(0,-1):"",loose:!1,items:[]};n=r?`\\d{1,9}\\${n.slice(-1)}`:`\\${n}`,this.options.pedantic&&(n=r?n:"[*+-]");const s=this.rules.other.listItemRegex(n);let l=!1;for(;t;){let h=!1,o="",c="";if(!(e=s.exec(t))||this.rules.block.hr.test(t))break;o=e[0],t=t.substring(o.length);let u=e[2].split(`
`,1)[0].replace(this.rules.other.listReplaceTabs,_=>" ".repeat(3*_.length)),p=t.split(`
`,1)[0],f=!u.trim(),b=0;if(this.options.pedantic?(b=2,c=u.trimStart()):f?b=e[1].length+1:(b=e[2].search(this.rules.other.nonSpaceChar),b=b>4?1:b,c=u.slice(b),b+=e[1].length),f&&this.rules.other.blankLine.test(p)&&(o+=p+`
`,t=t.substring(p.length+1),h=!0),!h){const _=this.rules.other.nextBulletRegex(b),g=this.rules.other.hrRegex(b),T=this.rules.other.fencesBeginRegex(b),S=this.rules.other.headingBeginRegex(b),I=this.rules.other.htmlBeginRegex(b);for(;t;){const B=t.split(`
`,1)[0];let z;if(p=B,this.options.pedantic?(p=p.replace(this.rules.other.listReplaceNesting,"  "),z=p):z=p.replace(this.rules.other.tabCharGlobal,"    "),T.test(p)||S.test(p)||I.test(p)||_.test(p)||g.test(p))break;if(z.search(this.rules.other.nonSpaceChar)>=b||!p.trim())c+=`
`+z.slice(b);else{if(f||u.replace(this.rules.other.tabCharGlobal,"    ").search(this.rules.other.nonSpaceChar)>=4||T.test(u)||S.test(u)||g.test(u))break;c+=`
`+p}!f&&!p.trim()&&(f=!0),o+=B+`
`,t=t.substring(B.length+1),u=z.slice(b)}}i.loose||(l?i.loose=!0:this.rules.other.doubleBlankLine.test(o)&&(l=!0));let v=null,k;this.options.gfm&&(v=this.rules.other.listIsTask.exec(c),v&&(k=v[0]!=="[ ] ",c=c.replace(this.rules.other.listReplaceTask,""))),i.items.push({type:"list_item",raw:o,task:!!v,checked:k,loose:!1,text:c,tokens:[]}),i.raw+=o}const a=i.items.at(-1);if(a)a.raw=a.raw.trimEnd(),a.text=a.text.trimEnd();else return;i.raw=i.raw.trimEnd();for(let h=0;h<i.items.length;h++)if(this.lexer.state.top=!1,i.items[h].tokens=this.lexer.blockTokens(i.items[h].text,[]),!i.loose){const o=i.items[h].tokens.filter(u=>u.type==="space"),c=o.length>0&&o.some(u=>this.rules.other.anyLine.test(u.raw));i.loose=c}if(i.loose)for(let h=0;h<i.items.length;h++)i.items[h].loose=!0;return i}}html(t){const e=this.rules.block.html.exec(t);if(e)return{type:"html",block:!0,raw:e[0],pre:e[1]==="pre"||e[1]==="script"||e[1]==="style",text:e[0]}}def(t){const e=this.rules.block.def.exec(t);if(e){const n=e[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal," "),r=e[2]?e[2].replace(this.rules.other.hrefBrackets,"$1").replace(this.rules.inline.anyPunctuation,"$1"):"",i=e[3]?e[3].substring(1,e[3].length-1).replace(this.rules.inline.anyPunctuation,"$1"):e[3];return{type:"def",tag:n,raw:e[0],href:r,title:i}}}table(t){var l;const e=this.rules.block.table.exec(t);if(!e||!this.rules.other.tableDelimiter.test(e[2]))return;const n=Mt(e[1]),r=e[2].replace(this.rules.other.tableAlignChars,"").split("|"),i=(l=e[3])!=null&&l.trim()?e[3].replace(this.rules.other.tableRowBlankLine,"").split(`
`):[],s={type:"table",raw:e[0],header:[],align:[],rows:[]};if(n.length===r.length){for(const a of r)this.rules.other.tableAlignRight.test(a)?s.align.push("right"):this.rules.other.tableAlignCenter.test(a)?s.align.push("center"):this.rules.other.tableAlignLeft.test(a)?s.align.push("left"):s.align.push(null);for(let a=0;a<n.length;a++)s.header.push({text:n[a],tokens:this.lexer.inline(n[a]),header:!0,align:s.align[a]});for(const a of i)s.rows.push(Mt(a,s.header.length).map((h,o)=>({text:h,tokens:this.lexer.inline(h),header:!1,align:s.align[o]})));return s}}lheading(t){const e=this.rules.block.lheading.exec(t);if(e)return{type:"heading",raw:e[0],depth:e[2].charAt(0)==="="?1:2,text:e[1],tokens:this.lexer.inline(e[1])}}paragraph(t){const e=this.rules.block.paragraph.exec(t);if(e){const n=e[1].charAt(e[1].length-1)===`
`?e[1].slice(0,-1):e[1];return{type:"paragraph",raw:e[0],text:n,tokens:this.lexer.inline(n)}}}text(t){const e=this.rules.block.text.exec(t);if(e)return{type:"text",raw:e[0],text:e[0],tokens:this.lexer.inline(e[0])}}escape(t){const e=this.rules.inline.escape.exec(t);if(e)return{type:"escape",raw:e[0],text:e[1]}}tag(t){const e=this.rules.inline.tag.exec(t);if(e)return!this.lexer.state.inLink&&this.rules.other.startATag.test(e[0])?this.lexer.state.inLink=!0:this.lexer.state.inLink&&this.rules.other.endATag.test(e[0])&&(this.lexer.state.inLink=!1),!this.lexer.state.inRawBlock&&this.rules.other.startPreScriptTag.test(e[0])?this.lexer.state.inRawBlock=!0:this.lexer.state.inRawBlock&&this.rules.other.endPreScriptTag.test(e[0])&&(this.lexer.state.inRawBlock=!1),{type:"html",raw:e[0],inLink:this.lexer.state.inLink,inRawBlock:this.lexer.state.inRawBlock,block:!1,text:e[0]}}link(t){const e=this.rules.inline.link.exec(t);if(e){const n=e[2].trim();if(!this.options.pedantic&&this.rules.other.startAngleBracket.test(n)){if(!this.rules.other.endAngleBracket.test(n))return;const s=se(n.slice(0,-1),"\\");if((n.length-s.length)%2===0)return}else{const s=Wn(e[2],"()");if(s===-2)return;if(s>-1){const a=(e[0].indexOf("!")===0?5:4)+e[1].length+s;e[2]=e[2].substring(0,s),e[0]=e[0].substring(0,a).trim(),e[3]=""}}let r=e[2],i="";if(this.options.pedantic){const s=this.rules.other.pedanticHrefTitle.exec(r);s&&(r=s[1],i=s[3])}else i=e[3]?e[3].slice(1,-1):"";return r=r.trim(),this.rules.other.startAngleBracket.test(r)&&(this.options.pedantic&&!this.rules.other.endAngleBracket.test(n)?r=r.slice(1):r=r.slice(1,-1)),Ft(e,{href:r&&r.replace(this.rules.inline.anyPunctuation,"$1"),title:i&&i.replace(this.rules.inline.anyPunctuation,"$1")},e[0],this.lexer,this.rules)}}reflink(t,e){let n;if((n=this.rules.inline.reflink.exec(t))||(n=this.rules.inline.nolink.exec(t))){const r=(n[2]||n[1]).replace(this.rules.other.multipleSpaceGlobal," "),i=e[r.toLowerCase()];if(!i){const s=n[0].charAt(0);return{type:"text",raw:s,text:s}}return Ft(n,i,n[0],this.lexer,this.rules)}}emStrong(t,e,n=""){let r=this.rules.inline.emStrongLDelim.exec(t);if(!r||r[3]&&n.match(this.rules.other.unicodeAlphaNumeric))return;if(!(r[1]||r[2]||"")||!n||this.rules.inline.punctuation.exec(n)){const s=[...r[0]].length-1;let l,a,h=s,o=0;const c=r[0][0]==="*"?this.rules.inline.emStrongRDelimAst:this.rules.inline.emStrongRDelimUnd;for(c.lastIndex=0,e=e.slice(-1*t.length+s);(r=c.exec(e))!=null;){if(l=r[1]||r[2]||r[3]||r[4]||r[5]||r[6],!l)continue;if(a=[...l].length,r[3]||r[4]){h+=a;continue}else if((r[5]||r[6])&&s%3&&!((s+a)%3)){o+=a;continue}if(h-=a,h>0)continue;a=Math.min(a,a+h+o);const u=[...r[0]][0].length,p=t.slice(0,s+r.index+u+a);if(Math.min(s,a)%2){const b=p.slice(1,-1);return{type:"em",raw:p,text:b,tokens:this.lexer.inlineTokens(b)}}const f=p.slice(2,-2);return{type:"strong",raw:p,text:f,tokens:this.lexer.inlineTokens(f)}}}}codespan(t){const e=this.rules.inline.code.exec(t);if(e){let n=e[2].replace(this.rules.other.newLineCharGlobal," ");const r=this.rules.other.nonSpaceChar.test(n),i=this.rules.other.startingSpaceChar.test(n)&&this.rules.other.endingSpaceChar.test(n);return r&&i&&(n=n.substring(1,n.length-1)),{type:"codespan",raw:e[0],text:n}}}br(t){const e=this.rules.inline.br.exec(t);if(e)return{type:"br",raw:e[0]}}del(t){const e=this.rules.inline.del.exec(t);if(e)return{type:"del",raw:e[0],text:e[2],tokens:this.lexer.inlineTokens(e[2])}}autolink(t){const e=this.rules.inline.autolink.exec(t);if(e){let n,r;return e[2]==="@"?(n=e[1],r="mailto:"+n):(n=e[1],r=n),{type:"link",raw:e[0],text:n,href:r,tokens:[{type:"text",raw:n,text:n}]}}}url(t){var n;let e;if(e=this.rules.inline.url.exec(t)){let r,i;if(e[2]==="@")r=e[0],i="mailto:"+r;else{let s;do s=e[0],e[0]=((n=this.rules.inline._backpedal.exec(e[0]))==null?void 0:n[0])??"";while(s!==e[0]);r=e[0],e[1]==="www."?i="http://"+e[0]:i=e[0]}return{type:"link",raw:e[0],text:r,href:i,tokens:[{type:"text",raw:r,text:r}]}}}inlineText(t){const e=this.rules.inline.text.exec(t);if(e){const n=this.lexer.state.inRawBlock;return{type:"text",raw:e[0],text:e[0],escaped:n}}}},W=class Ge{constructor(e){y(this,"tokens");y(this,"options");y(this,"state");y(this,"tokenizer");y(this,"inlineQueue");this.tokens=[],this.tokens.links=Object.create(null),this.options=e||G,this.options.tokenizer=this.options.tokenizer||new me,this.tokenizer=this.options.tokenizer,this.tokenizer.options=this.options,this.tokenizer.lexer=this,this.inlineQueue=[],this.state={inLink:!1,inRawBlock:!1,top:!0};const n={other:A,block:_e.normal,inline:ie.normal};this.options.pedantic?(n.block=_e.pedantic,n.inline=ie.pedantic):this.options.gfm&&(n.block=_e.gfm,this.options.breaks?n.inline=ie.breaks:n.inline=ie.gfm),this.tokenizer.rules=n}static get rules(){return{block:_e,inline:ie}}static lex(e,n){return new Ge(n).lex(e)}static lexInline(e,n){return new Ge(n).inlineTokens(e)}lex(e){e=e.replace(A.carriageReturn,`
`),this.blockTokens(e,this.tokens);for(let n=0;n<this.inlineQueue.length;n++){const r=this.inlineQueue[n];this.inlineTokens(r.src,r.tokens)}return this.inlineQueue=[],this.tokens}blockTokens(e,n=[],r=!1){var i,s,l;for(this.options.pedantic&&(e=e.replace(A.tabCharGlobal,"    ").replace(A.spaceLine,""));e;){let a;if((s=(i=this.options.extensions)==null?void 0:i.block)!=null&&s.some(o=>(a=o.call({lexer:this},e,n))?(e=e.substring(a.raw.length),n.push(a),!0):!1))continue;if(a=this.tokenizer.space(e)){e=e.substring(a.raw.length);const o=n.at(-1);a.raw.length===1&&o!==void 0?o.raw+=`
`:n.push(a);continue}if(a=this.tokenizer.code(e)){e=e.substring(a.raw.length);const o=n.at(-1);(o==null?void 0:o.type)==="paragraph"||(o==null?void 0:o.type)==="text"?(o.raw+=`
`+a.raw,o.text+=`
`+a.text,this.inlineQueue.at(-1).src=o.text):n.push(a);continue}if(a=this.tokenizer.fences(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.heading(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.hr(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.blockquote(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.list(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.html(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.def(e)){e=e.substring(a.raw.length);const o=n.at(-1);(o==null?void 0:o.type)==="paragraph"||(o==null?void 0:o.type)==="text"?(o.raw+=`
`+a.raw,o.text+=`
`+a.raw,this.inlineQueue.at(-1).src=o.text):this.tokens.links[a.tag]||(this.tokens.links[a.tag]={href:a.href,title:a.title});continue}if(a=this.tokenizer.table(e)){e=e.substring(a.raw.length),n.push(a);continue}if(a=this.tokenizer.lheading(e)){e=e.substring(a.raw.length),n.push(a);continue}let h=e;if((l=this.options.extensions)!=null&&l.startBlock){let o=1/0;const c=e.slice(1);let u;this.options.extensions.startBlock.forEach(p=>{u=p.call({lexer:this},c),typeof u=="number"&&u>=0&&(o=Math.min(o,u))}),o<1/0&&o>=0&&(h=e.substring(0,o+1))}if(this.state.top&&(a=this.tokenizer.paragraph(h))){const o=n.at(-1);r&&(o==null?void 0:o.type)==="paragraph"?(o.raw+=`
`+a.raw,o.text+=`
`+a.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=o.text):n.push(a),r=h.length!==e.length,e=e.substring(a.raw.length);continue}if(a=this.tokenizer.text(e)){e=e.substring(a.raw.length);const o=n.at(-1);(o==null?void 0:o.type)==="text"?(o.raw+=`
`+a.raw,o.text+=`
`+a.text,this.inlineQueue.pop(),this.inlineQueue.at(-1).src=o.text):n.push(a);continue}if(e){const o="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(o);break}else throw new Error(o)}}return this.state.top=!0,n}inline(e,n=[]){return this.inlineQueue.push({src:e,tokens:n}),n}inlineTokens(e,n=[]){var a,h,o;let r=e,i=null;if(this.tokens.links){const c=Object.keys(this.tokens.links);if(c.length>0)for(;(i=this.tokenizer.rules.inline.reflinkSearch.exec(r))!=null;)c.includes(i[0].slice(i[0].lastIndexOf("[")+1,-1))&&(r=r.slice(0,i.index)+"["+"a".repeat(i[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex))}for(;(i=this.tokenizer.rules.inline.anyPunctuation.exec(r))!=null;)r=r.slice(0,i.index)+"++"+r.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);for(;(i=this.tokenizer.rules.inline.blockSkip.exec(r))!=null;)r=r.slice(0,i.index)+"["+"a".repeat(i[0].length-2)+"]"+r.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);let s=!1,l="";for(;e;){s||(l=""),s=!1;let c;if((h=(a=this.options.extensions)==null?void 0:a.inline)!=null&&h.some(p=>(c=p.call({lexer:this},e,n))?(e=e.substring(c.raw.length),n.push(c),!0):!1))continue;if(c=this.tokenizer.escape(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.tag(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.link(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.reflink(e,this.tokens.links)){e=e.substring(c.raw.length);const p=n.at(-1);c.type==="text"&&(p==null?void 0:p.type)==="text"?(p.raw+=c.raw,p.text+=c.text):n.push(c);continue}if(c=this.tokenizer.emStrong(e,r,l)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.codespan(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.br(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.del(e)){e=e.substring(c.raw.length),n.push(c);continue}if(c=this.tokenizer.autolink(e)){e=e.substring(c.raw.length),n.push(c);continue}if(!this.state.inLink&&(c=this.tokenizer.url(e))){e=e.substring(c.raw.length),n.push(c);continue}let u=e;if((o=this.options.extensions)!=null&&o.startInline){let p=1/0;const f=e.slice(1);let b;this.options.extensions.startInline.forEach(v=>{b=v.call({lexer:this},f),typeof b=="number"&&b>=0&&(p=Math.min(p,b))}),p<1/0&&p>=0&&(u=e.substring(0,p+1))}if(c=this.tokenizer.inlineText(u)){e=e.substring(c.raw.length),c.raw.slice(-1)!=="_"&&(l=c.raw.slice(-1)),s=!0;const p=n.at(-1);(p==null?void 0:p.type)==="text"?(p.raw+=c.raw,p.text+=c.text):n.push(c);continue}if(e){const p="Infinite loop on byte: "+e.charCodeAt(0);if(this.options.silent){console.error(p);break}else throw new Error(p)}}return n}},xe=class{constructor(t){y(this,"options");y(this,"parser");this.options=t||G}space(t){return""}code({text:t,lang:e,escaped:n}){var s;const r=(s=(e||"").match(A.notSpaceStart))==null?void 0:s[0],i=t.replace(A.endingNewline,"")+`
`;return r?'<pre><code class="language-'+H(r)+'">'+(n?i:H(i,!0))+`</code></pre>
`:"<pre><code>"+(n?i:H(i,!0))+`</code></pre>
`}blockquote({tokens:t}){return`<blockquote>
${this.parser.parse(t)}</blockquote>
`}html({text:t}){return t}heading({tokens:t,depth:e}){return`<h${e}>${this.parser.parseInline(t)}</h${e}>
`}hr(t){return`<hr>
`}list(t){const e=t.ordered,n=t.start;let r="";for(let l=0;l<t.items.length;l++){const a=t.items[l];r+=this.listitem(a)}const i=e?"ol":"ul",s=e&&n!==1?' start="'+n+'"':"";return"<"+i+s+`>
`+r+"</"+i+`>
`}listitem(t){var n;let e="";if(t.task){const r=this.checkbox({checked:!!t.checked});t.loose?((n=t.tokens[0])==null?void 0:n.type)==="paragraph"?(t.tokens[0].text=r+" "+t.tokens[0].text,t.tokens[0].tokens&&t.tokens[0].tokens.length>0&&t.tokens[0].tokens[0].type==="text"&&(t.tokens[0].tokens[0].text=r+" "+H(t.tokens[0].tokens[0].text),t.tokens[0].tokens[0].escaped=!0)):t.tokens.unshift({type:"text",raw:r+" ",text:r+" ",escaped:!0}):e+=r+" "}return e+=this.parser.parse(t.tokens,!!t.loose),`<li>${e}</li>
`}checkbox({checked:t}){return"<input "+(t?'checked="" ':"")+'disabled="" type="checkbox">'}paragraph({tokens:t}){return`<p>${this.parser.parseInline(t)}</p>
`}table(t){let e="",n="";for(let i=0;i<t.header.length;i++)n+=this.tablecell(t.header[i]);e+=this.tablerow({text:n});let r="";for(let i=0;i<t.rows.length;i++){const s=t.rows[i];n="";for(let l=0;l<s.length;l++)n+=this.tablecell(s[l]);r+=this.tablerow({text:n})}return r&&(r=`<tbody>${r}</tbody>`),`<table>
<thead>
`+e+`</thead>
`+r+`</table>
`}tablerow({text:t}){return`<tr>
${t}</tr>
`}tablecell(t){const e=this.parser.parseInline(t.tokens),n=t.header?"th":"td";return(t.align?`<${n} align="${t.align}">`:`<${n}>`)+e+`</${n}>
`}strong({tokens:t}){return`<strong>${this.parser.parseInline(t)}</strong>`}em({tokens:t}){return`<em>${this.parser.parseInline(t)}</em>`}codespan({text:t}){return`<code>${H(t,!0)}</code>`}br(t){return"<br>"}del({tokens:t}){return`<del>${this.parser.parseInline(t)}</del>`}link({href:t,title:e,tokens:n}){const r=this.parser.parseInline(n),i=Nt(t);if(i===null)return r;t=i;let s='<a href="'+t+'"';return e&&(s+=' title="'+H(e)+'"'),s+=">"+r+"</a>",s}image({href:t,title:e,text:n,tokens:r}){r&&(n=this.parser.parseInline(r,this.parser.textRenderer));const i=Nt(t);if(i===null)return H(n);t=i;let s=`<img src="${t}" alt="${n}"`;return e&&(s+=` title="${H(e)}"`),s+=">",s}text(t){return"tokens"in t&&t.tokens?this.parser.parseInline(t.tokens):"escaped"in t&&t.escaped?t.text:H(t.text)}},We=class{strong({text:t}){return t}em({text:t}){return t}codespan({text:t}){return t}del({text:t}){return t}html({text:t}){return t}text({text:t}){return t}link({text:t}){return""+t}image({text:t}){return""+t}br(){return""}},U=class Qe{constructor(e){y(this,"options");y(this,"renderer");y(this,"textRenderer");this.options=e||G,this.options.renderer=this.options.renderer||new xe,this.renderer=this.options.renderer,this.renderer.options=this.options,this.renderer.parser=this,this.textRenderer=new We}static parse(e,n){return new Qe(n).parse(e)}static parseInline(e,n){return new Qe(n).parseInline(e)}parse(e,n=!0){var i,s;let r="";for(let l=0;l<e.length;l++){const a=e[l];if((s=(i=this.options.extensions)==null?void 0:i.renderers)!=null&&s[a.type]){const o=a,c=this.options.extensions.renderers[o.type].call({parser:this},o);if(c!==!1||!["space","hr","heading","code","table","blockquote","list","html","paragraph","text"].includes(o.type)){r+=c||"";continue}}const h=a;switch(h.type){case"space":{r+=this.renderer.space(h);continue}case"hr":{r+=this.renderer.hr(h);continue}case"heading":{r+=this.renderer.heading(h);continue}case"code":{r+=this.renderer.code(h);continue}case"table":{r+=this.renderer.table(h);continue}case"blockquote":{r+=this.renderer.blockquote(h);continue}case"list":{r+=this.renderer.list(h);continue}case"html":{r+=this.renderer.html(h);continue}case"paragraph":{r+=this.renderer.paragraph(h);continue}case"text":{let o=h,c=this.renderer.text(o);for(;l+1<e.length&&e[l+1].type==="text";)o=e[++l],c+=`
`+this.renderer.text(o);n?r+=this.renderer.paragraph({type:"paragraph",raw:c,text:c,tokens:[{type:"text",raw:c,text:c,escaped:!0}]}):r+=c;continue}default:{const o='Token with "'+h.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return r}parseInline(e,n=this.renderer){var i,s;let r="";for(let l=0;l<e.length;l++){const a=e[l];if((s=(i=this.options.extensions)==null?void 0:i.renderers)!=null&&s[a.type]){const o=this.options.extensions.renderers[a.type].call({parser:this},a);if(o!==!1||!["escape","html","link","image","strong","em","codespan","br","del","text"].includes(a.type)){r+=o||"";continue}}const h=a;switch(h.type){case"escape":{r+=n.text(h);break}case"html":{r+=n.html(h);break}case"link":{r+=n.link(h);break}case"image":{r+=n.image(h);break}case"strong":{r+=n.strong(h);break}case"em":{r+=n.em(h);break}case"codespan":{r+=n.codespan(h);break}case"br":{r+=n.br(h);break}case"del":{r+=n.del(h);break}case"text":{r+=n.text(h);break}default:{const o='Token with "'+h.type+'" type was not found.';if(this.options.silent)return console.error(o),"";throw new Error(o)}}}return r}},ve=(Oe=class{constructor(t){y(this,"options");y(this,"block");this.options=t||G}preprocess(t){return t}postprocess(t){return t}processAllTokens(t){return t}provideLexer(){return this.block?W.lex:W.lexInline}provideParser(){return this.block?U.parse:U.parseInline}},y(Oe,"passThroughHooks",new Set(["preprocess","postprocess","processAllTokens"])),Oe),On=class{constructor(...t){y(this,"defaults",Ee());y(this,"options",this.setOptions);y(this,"parse",this.parseMarkdown(!0));y(this,"parseInline",this.parseMarkdown(!1));y(this,"Parser",U);y(this,"Renderer",xe);y(this,"TextRenderer",We);y(this,"Lexer",W);y(this,"Tokenizer",me);y(this,"Hooks",ve);this.use(...t)}walkTokens(t,e){var r,i;let n=[];for(const s of t)switch(n=n.concat(e.call(this,s)),s.type){case"table":{const l=s;for(const a of l.header)n=n.concat(this.walkTokens(a.tokens,e));for(const a of l.rows)for(const h of a)n=n.concat(this.walkTokens(h.tokens,e));break}case"list":{const l=s;n=n.concat(this.walkTokens(l.items,e));break}default:{const l=s;(i=(r=this.defaults.extensions)==null?void 0:r.childTokens)!=null&&i[l.type]?this.defaults.extensions.childTokens[l.type].forEach(a=>{const h=l[a].flat(1/0);n=n.concat(this.walkTokens(h,e))}):l.tokens&&(n=n.concat(this.walkTokens(l.tokens,e)))}}return n}use(...t){const e=this.defaults.extensions||{renderers:{},childTokens:{}};return t.forEach(n=>{const r={...n};if(r.async=this.defaults.async||r.async||!1,n.extensions&&(n.extensions.forEach(i=>{if(!i.name)throw new Error("extension name required");if("renderer"in i){const s=e.renderers[i.name];s?e.renderers[i.name]=function(...l){let a=i.renderer.apply(this,l);return a===!1&&(a=s.apply(this,l)),a}:e.renderers[i.name]=i.renderer}if("tokenizer"in i){if(!i.level||i.level!=="block"&&i.level!=="inline")throw new Error("extension level must be 'block' or 'inline'");const s=e[i.level];s?s.unshift(i.tokenizer):e[i.level]=[i.tokenizer],i.start&&(i.level==="block"?e.startBlock?e.startBlock.push(i.start):e.startBlock=[i.start]:i.level==="inline"&&(e.startInline?e.startInline.push(i.start):e.startInline=[i.start]))}"childTokens"in i&&i.childTokens&&(e.childTokens[i.name]=i.childTokens)}),r.extensions=e),n.renderer){const i=this.defaults.renderer||new xe(this.defaults);for(const s in n.renderer){if(!(s in i))throw new Error(`renderer '${s}' does not exist`);if(["options","parser"].includes(s))continue;const l=s,a=n.renderer[l],h=i[l];i[l]=(...o)=>{let c=a.apply(i,o);return c===!1&&(c=h.apply(i,o)),c||""}}r.renderer=i}if(n.tokenizer){const i=this.defaults.tokenizer||new me(this.defaults);for(const s in n.tokenizer){if(!(s in i))throw new Error(`tokenizer '${s}' does not exist`);if(["options","rules","lexer"].includes(s))continue;const l=s,a=n.tokenizer[l],h=i[l];i[l]=(...o)=>{let c=a.apply(i,o);return c===!1&&(c=h.apply(i,o)),c}}r.tokenizer=i}if(n.hooks){const i=this.defaults.hooks||new ve;for(const s in n.hooks){if(!(s in i))throw new Error(`hook '${s}' does not exist`);if(["options","block"].includes(s))continue;const l=s,a=n.hooks[l],h=i[l];ve.passThroughHooks.has(s)?i[l]=o=>{if(this.defaults.async)return Promise.resolve(a.call(i,o)).then(u=>h.call(i,u));const c=a.call(i,o);return h.call(i,c)}:i[l]=(...o)=>{let c=a.apply(i,o);return c===!1&&(c=h.apply(i,o)),c}}r.hooks=i}if(n.walkTokens){const i=this.defaults.walkTokens,s=n.walkTokens;r.walkTokens=function(l){let a=[];return a.push(s.call(this,l)),i&&(a=a.concat(i.call(this,l))),a}}this.defaults={...this.defaults,...r}}),this}setOptions(t){return this.defaults={...this.defaults,...t},this}lexer(t,e){return W.lex(t,e??this.defaults)}parser(t,e){return U.parse(t,e??this.defaults)}parseMarkdown(t){return(n,r)=>{const i={...r},s={...this.defaults,...i},l=this.onError(!!s.silent,!!s.async);if(this.defaults.async===!0&&i.async===!1)return l(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));if(typeof n>"u"||n===null)return l(new Error("marked(): input parameter is undefined or null"));if(typeof n!="string")return l(new Error("marked(): input parameter is of type "+Object.prototype.toString.call(n)+", string expected"));s.hooks&&(s.hooks.options=s,s.hooks.block=t);const a=s.hooks?s.hooks.provideLexer():t?W.lex:W.lexInline,h=s.hooks?s.hooks.provideParser():t?U.parse:U.parseInline;if(s.async)return Promise.resolve(s.hooks?s.hooks.preprocess(n):n).then(o=>a(o,s)).then(o=>s.hooks?s.hooks.processAllTokens(o):o).then(o=>s.walkTokens?Promise.all(this.walkTokens(o,s.walkTokens)).then(()=>o):o).then(o=>h(o,s)).then(o=>s.hooks?s.hooks.postprocess(o):o).catch(l);try{s.hooks&&(n=s.hooks.preprocess(n));let o=a(n,s);s.hooks&&(o=s.hooks.processAllTokens(o)),s.walkTokens&&this.walkTokens(o,s.walkTokens);let c=h(o,s);return s.hooks&&(c=s.hooks.postprocess(c)),c}catch(o){return l(o)}}}onError(t,e){return n=>{if(n.message+=`
Please report this to https://github.com/markedjs/marked.`,t){const r="<p>An error occurred:</p><pre>"+H(n.message+"",!0)+"</pre>";return e?Promise.resolve(r):r}if(e)return Promise.reject(n);throw n}}},Q=new On;function x(t,e){return Q.parse(t,e)}x.options=x.setOptions=function(t){return Q.setOptions(t),x.defaults=Q.defaults,yt(x.defaults),x},x.getDefaults=Ee,x.defaults=G,x.use=function(...t){return Q.use(...t),x.defaults=Q.defaults,yt(x.defaults),x},x.walkTokens=function(t,e){return Q.walkTokens(t,e)},x.parseInline=Q.parseInline,x.Parser=U,x.parser=U.parse,x.Renderer=xe,x.TextRenderer=We,x.Lexer=W,x.lexer=W.lex,x.Tokenizer=me,x.Hooks=ve,x.parse=x,x.options,x.setOptions,x.use,x.walkTokens,x.parseInline,U.parse,W.lex;function Zn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"})})}function qt({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("line",{x1:"18",y1:"6",x2:"6",y2:"18"}),d("line",{x1:"6",y1:"6",x2:"18",y2:"18"})]})}function Gn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m5 12 7-7 7 7"}),d("path",{d:"M12 19V5"})]})}function Qn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"m6 9 6 6 6-6"})})}function Ht({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"})})}function Kn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"}),d("path",{d:"M5 3v4"}),d("path",{d:"M19 17v4"}),d("path",{d:"M3 5h4"}),d("path",{d:"M17 19h4"})]})}function Vn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"15 3 21 3 21 9"}),d("polyline",{points:"9 21 3 21 3 15"}),d("line",{x1:"21",y1:"3",x2:"14",y2:"10"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Yn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("polyline",{points:"4 14 10 14 10 20"}),d("polyline",{points:"20 10 14 10 14 4"}),d("line",{x1:"14",y1:"10",x2:"21",y2:"3"}),d("line",{x1:"3",y1:"21",x2:"10",y2:"14"})]})}function Xn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("circle",{cx:"12",cy:"12",r:"10"}),d("path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"}),d("path",{d:"M12 17h.01"})]})}function Jn({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M8.5 8.5a3.5 3.5 0 1 1 5 3.15c-.65.4-1.5 1.15-1.5 2.35v1"}),d("circle",{cx:"12",cy:"19",r:"0.5",fill:"currentColor"})]})}function er({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:d("path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z"})})}function tr({className:t}){return d("svg",{className:t,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[d("path",{d:"M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"}),d("polyline",{points:"14 2 14 8 20 8"})]})}x.setOptions({breaks:!0,gfm:!0});const Dt=new x.Renderer;Dt.link=({href:t,title:e,text:n})=>{const r=e?` title="${e}"`:"";return`<a href="${t}" target="_blank" rel="noopener noreferrer"${r}>${n}</a>`},x.use({renderer:Dt});function nr(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}function rr(t){if(!t)return"";let e=t;return e=e.replace(/【[^】]*】/g,""),e=e.replace(/Citation:\s*[^\n.]+[.\n]/gi,""),e=e.replace(/\[Source:[^\]]*\]/gi,""),e=e.replace(/\[\d+\]/g,""),e=e.replace(/\(Source:[^)]*\)/gi,""),x.parse(e,{async:!1})}function ir({message:t}){const[e,n]=M(!1),r=t.role==="user",i=t.citations&&t.citations.length>0;return d("div",{className:`kcb-message ${t.role}`,children:[d("div",{className:"kcb-message-bubble",dangerouslySetInnerHTML:{__html:r?nr(t.content):rr(t.content)}}),t.isStreaming&&d("span",{className:"kcb-cursor"}),!r&&i&&d("div",{className:"kcb-sources",children:[d("button",{className:`kcb-sources-trigger ${e?"open":""}`,onClick:()=>n(!e),children:[d(Ht,{}),t.citations.length," source",t.citations.length!==1?"s":"",d(Qn,{})]}),d("div",{className:`kcb-sources-list ${e?"open":""}`,children:t.citations.map((s,l)=>{var o;const a=(o=s.url)==null?void 0:o.startsWith("upload://"),h=s.title||(a?"Uploaded Document":s.url)||`Source ${l+1}`;return a?d("div",{className:"kcb-source kcb-source-file",children:[d(tr,{}),d("span",{className:"kcb-source-title",children:h})]},l):d("a",{href:s.url||"#",target:"_blank",rel:"noopener noreferrer",className:"kcb-source",children:[d(Ht,{}),d("span",{className:"kcb-source-title",children:h})]},l)})})]})]})}function sr(){return d("div",{className:"kcb-typing",children:[d("div",{className:"kcb-typing-dot"}),d("div",{className:"kcb-typing-dot"}),d("div",{className:"kcb-typing-dot"})]})}function jt({options:t,initialOpen:e=!1,onOpenChange:n}){var Ot,Zt,Gt,Qt,Kt,Vt;const{token:r,apiBase:i="",position:s="bottom-right"}=t,[l,a]=M(e),[h,o]=M(!1),[c,u]=M(""),p=te(null),f=te(null),{config:b}=cn({token:r,apiBase:i}),{messages:v,isLoading:k,sendMessage:_}=ln({token:r,apiBase:i});ee(()=>{p.current&&p.current.scrollIntoView({behavior:"smooth"})},[v,k]),ee(()=>{l&&f.current&&setTimeout(()=>{var L;return(L=f.current)==null?void 0:L.focus()},100)},[l]);const g=te(!1);ee(()=>{g.current&&!k&&l&&setTimeout(()=>{var L;return(L=f.current)==null?void 0:L.focus()},50),g.current=k},[k,l]),ee(()=>{n==null||n(l)},[l,n]);const T=()=>{a(!l)},S=()=>{c.trim()&&!k&&(_(c),u(""),f.current&&(f.current.style.height="auto"),setTimeout(()=>{var L;(L=f.current)==null||L.focus()},50))},I=L=>{L.key==="Enter"&&!L.shiftKey&&(L.preventDefault(),S())},B=L=>{const we=L.target;u(we.value),we.style.height="auto",we.style.height=Math.min(we.scrollHeight,120)+"px"},z=s==="bottom-left",D=(b==null?void 0:b.agentName)||"Assistant",F=(b==null?void 0:b.welcomeMessage)||"How can I help?",O=(b==null?void 0:b.description)||"Ask me anything. I'm here to assist you.",C=b==null?void 0:b.logoUrl,E=v.length===0&&!k,ae=((Ot=b==null?void 0:b.theme)==null?void 0:Ot.buttonStyle)||"circle",oe=((Zt=b==null?void 0:b.theme)==null?void 0:Zt.buttonSize)||"medium",P=((Gt=b==null?void 0:b.theme)==null?void 0:Gt.buttonText)||"Chat with us",Ze=((Qt=b==null?void 0:b.theme)==null?void 0:Qt.buttonIcon)||"chat",le=((Kt=b==null?void 0:b.theme)==null?void 0:Kt.buttonColor)||"#2563eb",Ut=(Vt=b==null?void 0:b.theme)==null?void 0:Vt.customIconUrl,lr=()=>{if(Ut)return d("img",{src:Ut,alt:"",className:"kcb-launcher-custom-icon"});switch(Ze){case"help":return d(Xn,{});case"question":return d(Jn,{});case"message":return d(er,{});case"chat":default:return d(Zn,{})}};return d("div",{className:`kcb-container ${z?"left":""}`,children:[d("div",{className:`kcb-window ${l?"open":""} ${h?"expanded":""}`,children:[d("div",{className:"kcb-header",children:[d("div",{className:"kcb-header-left",children:[C&&d("img",{src:C,alt:"",className:"kcb-header-logo"}),d("h2",{className:"kcb-header-title",children:D})]}),d("div",{className:"kcb-header-actions",children:[d("button",{className:"kcb-header-btn",onClick:()=>o(!h),"aria-label":h?"Shrink chat":"Expand chat",children:h?d(Yn,{}):d(Vn,{})}),d("button",{className:"kcb-header-btn",onClick:T,"aria-label":"Close chat",children:d(qt,{})})]})]}),d("div",{className:"kcb-messages",children:[E?d("div",{className:"kcb-empty",children:[d(Kn,{className:"kcb-empty-icon"}),d("h3",{className:"kcb-empty-title",children:O}),d("p",{className:"kcb-empty-text",children:F})]}):d(K,{children:[v.map(L=>d(ir,{message:L},L.id)),k&&d(sr,{})]}),d("div",{ref:p})]}),d("div",{className:"kcb-input-area",children:d("div",{className:"kcb-input-container",children:[d("textarea",{ref:f,className:"kcb-input",placeholder:"Type a message...",value:c,onInput:B,onKeyDown:I,rows:1,disabled:k}),d("button",{className:"kcb-send",onClick:S,disabled:!c.trim()||k,"aria-label":"Send message",children:d(Gn,{})})]})}),d("div",{className:"kcb-footer",children:["Powered by ",d("a",{href:"https://kcb.ai",target:"_blank",rel:"noopener",children:"KCB"})]})]}),d("button",{className:`kcb-launcher kcb-launcher--${ae} kcb-launcher--${oe} ${l?"open":""}`,onClick:T,"aria-label":l?"Close chat":"Open chat",style:{backgroundColor:le},children:l?d(qt,{}):d(K,{children:[lr(),ae==="pill"&&d("span",{className:"kcb-launcher-text",children:P})]})})]})}const ar=`
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

  /* Launcher Button - Base Styles */
  .kcb-launcher {
    border: none;
    background: var(--kcb-accent);
    color: var(--kcb-text-inverse);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--kcb-space-sm);
    box-shadow: var(--kcb-shadow-lg);
    transition:
      transform var(--kcb-duration-normal) var(--kcb-ease-out),
      box-shadow var(--kcb-duration-normal) var(--kcb-ease-out),
      background var(--kcb-duration-fast);
    position: relative;
    overflow: hidden;
    font-family: var(--kcb-font-sans);
    font-weight: 500;
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
    transition: transform var(--kcb-duration-normal) var(--kcb-ease-out);
    flex-shrink: 0;
  }

  .kcb-launcher.open {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.8);
  }

  .kcb-launcher.open svg {
    transform: rotate(90deg) scale(0.9);
  }

  /* Button text for pill style */
  .kcb-launcher-text {
    white-space: nowrap;
  }

  /* Custom icon image */
  .kcb-launcher-custom-icon {
    width: 24px;
    height: 24px;
    object-fit: contain;
    flex-shrink: 0;
    transition: transform var(--kcb-duration-normal) var(--kcb-ease-out);
  }

  .kcb-launcher--small .kcb-launcher-custom-icon {
    width: 20px;
    height: 20px;
  }

  .kcb-launcher--large .kcb-launcher-custom-icon {
    width: 28px;
    height: 28px;
  }

  /* Button Style: Circle (default) */
  .kcb-launcher--circle {
    border-radius: var(--kcb-radius-full);
  }

  /* Button Style: Pill */
  .kcb-launcher--pill {
    border-radius: var(--kcb-radius-full);
    padding-left: var(--kcb-space-md);
    padding-right: var(--kcb-space-lg);
  }

  /* Button Style: Square */
  .kcb-launcher--square {
    border-radius: var(--kcb-radius-md);
  }

  /* Button Size: Small */
  .kcb-launcher--small {
    height: 44px;
    font-size: 13px;
  }
  .kcb-launcher--small.kcb-launcher--circle,
  .kcb-launcher--small.kcb-launcher--square {
    width: 44px;
  }
  .kcb-launcher--small svg {
    width: 20px;
    height: 20px;
  }

  /* Button Size: Medium (default) */
  .kcb-launcher--medium {
    height: 56px;
    font-size: 15px;
  }
  .kcb-launcher--medium.kcb-launcher--circle,
  .kcb-launcher--medium.kcb-launcher--square {
    width: 56px;
  }
  .kcb-launcher--medium svg {
    width: 24px;
    height: 24px;
  }

  /* Button Size: Large */
  .kcb-launcher--large {
    height: 64px;
    font-size: 16px;
  }
  .kcb-launcher--large.kcb-launcher--circle,
  .kcb-launcher--large.kcb-launcher--square {
    width: 64px;
  }
  .kcb-launcher--large svg {
    width: 28px;
    height: 28px;
  }

  /* Pill adjustments for sizes */
  .kcb-launcher--pill.kcb-launcher--small {
    padding-left: 12px;
    padding-right: 16px;
  }
  .kcb-launcher--pill.kcb-launcher--medium {
    padding-left: 16px;
    padding-right: 20px;
  }
  .kcb-launcher--pill.kcb-launcher--large {
    padding-left: 20px;
    padding-right: 24px;
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
    overflow-x: auto;
    max-width: 100%;
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
    max-width: 100%;
    border-collapse: collapse;
    margin: var(--kcb-space-sm) 0;
    font-size: 13px;
    display: block;
    overflow-x: auto;
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

  .kcb-source-file {
    cursor: default;
  }

  .kcb-source-file:hover {
    color: var(--kcb-text-secondary);
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
`;class or{constructor(){this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,this.openCallback=null,this.processQueue()}processQueue(){var n;const e=((n=window.kcb)==null?void 0:n.q)||[];for(const r of e)this.handleCommand(r[0],r[1])}handleCommand(e,n){switch(e){case"init":this.init(n);break;case"open":this.open();break;case"close":this.close();break;case"toggle":this.toggle();break;case"destroy":this.destroy();break;default:console.warn(`[KCB Widget] Unknown command: ${e}`)}}init(e){if(this.isInitialized){console.warn("[KCB Widget] Already initialized");return}if(!(e!=null&&e.token)){console.error("[KCB Widget] Token is required");return}this.options={...e,apiBase:e.apiBase||this.detectApiBase()},this.container=document.createElement("div"),this.container.id="kcb-widget-root",document.body.appendChild(this.container),this.shadowRoot=this.container.attachShadow({mode:"open"});const n=document.createElement("style");n.textContent=ar,this.shadowRoot.appendChild(n);const r=document.createElement("div");this.shadowRoot.appendChild(r),ut(d(jt,{options:this.options,initialOpen:this.openState,onOpenChange:i=>{var s;this.openState=i,(s=this.openCallback)==null||s.call(this,i)}}),r),this.isInitialized=!0,console.log("[KCB Widget] Initialized")}detectApiBase(){const e=document.querySelectorAll('script[src*="widget"]');for(const n of e){const r=n.getAttribute("src");if(r)try{return new URL(r,window.location.href).origin}catch{}}return window.location.origin}open(){if(!this.isInitialized){this.openState=!0;return}this.openState=!0,this.rerender()}close(){if(!this.isInitialized){this.openState=!1;return}this.openState=!1,this.rerender()}toggle(){this.openState=!this.openState,this.isInitialized&&this.rerender()}rerender(){if(!this.shadowRoot||!this.options)return;const e=this.shadowRoot.querySelector("div:last-child");e&&ut(d(jt,{options:this.options,initialOpen:this.openState,onOpenChange:n=>{var r;this.openState=n,(r=this.openCallback)==null||r.call(this,n)}}),e)}destroy(){this.container&&this.container.remove(),this.container=null,this.shadowRoot=null,this.options=null,this.isInitialized=!1,this.openState=!1,console.log("[KCB Widget] Destroyed")}onOpenChange(e){this.openCallback=e}}const Ue=new or;function Wt(t,e){Ue.handleCommand(t,e)}return window.kcb=Wt,window.KCBWidget=Ue,q.KCBWidget=Ue,q.kcb=Wt,Object.defineProperty(q,Symbol.toStringTag,{value:"Module"}),q}({});
