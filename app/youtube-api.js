/* YTM13 YouTube Data API v3 compatibility layer.
 * Public-data only: no OAuth is used.
 * Put the restricted browser API key in youtube-api-key.js.
 */
(function () {
  "use strict";

  const KEY = window.YTM13_YOUTUBE_API_KEY || "";
  const API = "https://www.googleapis.com/youtube/v3/";
  const region = (window.YTM13_YOUTUBE_REGION || "MX").toUpperCase();

  function fail(message) {
    throw new Error(message);
  }

  function api(path, params) {
    if (!KEY || KEY === "YOUR_YOUTUBE_DATA_API_KEY") {
      return Promise.reject(new Error("YTM13 YouTube API key is not configured."));
    }
    const url = new URL(API + path);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });
    url.searchParams.set("key", KEY);
    return fetch(url.toString()).then(async r => {
      const text = await r.text();
      if (!r.ok) {
        let detail = text;
        try { detail = JSON.parse(text).error?.message || detail; } catch (_) {}
        throw new Error("YouTube API " + r.status + ": " + detail);
      }
      return JSON.parse(text);
    });
  }

  function thumbs(t) {
    const x = t || {};
    return [
      x.default ? {url:x.default.url,width:x.default.width||120,height:x.default.height||90} : {url:"",width:120,height:90},
      x.medium ? {url:x.medium.url,width:x.medium.width||320,height:x.medium.height||180} : {url:x.default?.url||"",width:320,height:180},
      x.high ? {url:x.high.url,width:x.high.width||480,height:x.high.height||360} : {url:x.medium?.url||x.default?.url||"",width:480,height:360},
      x.standard ? {url:x.standard.url,width:x.standard.width||640,height:x.standard.height||480} : {url:x.high?.url||x.medium?.url||"",width:640,height:480},
      x.maxres ? {url:x.maxres.url,width:x.maxres.width||1280,height:x.maxres.height||720} : {url:x.high?.url||"",width:1280,height:720}
    ];
  }

  function durationText(iso) {
    if (!iso) return "";
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return "";
    const h = Number(m[1]||0), min = Number(m[2]||0), s = Number(m[3]||0);
    return h ? h+":"+String(min).padStart(2,"0")+":"+String(s).padStart(2,"0") : min+":"+String(s).padStart(2,"0");
  }

  function seconds(iso) {
    const m = durationText(iso).split(":").map(Number);
    return m.length === 3 ? m[0]*3600+m[1]*60+m[2] : (m[0]||0)*60+(m[1]||0);
  }

  function videoFrom(v) {
    const s=v.snippet||{}, st=v.statistics||{}, cd=v.contentDetails||{};
    return {
      type:"video", videoId:v.id?.videoId || v.id || "",
      title:s.title||"", author:s.channelTitle||"", channelTitle:s.channelTitle||"",
      authorId:s.channelId||"", channelId:s.channelId||"",
      description:s.description||"", publishedAt:s.publishedAt||"",
      published:s.publishedAt ? Math.floor(new Date(s.publishedAt).getTime()/1000) : 0,
      publishedText:s.publishedAt ? new Date(s.publishedAt).toLocaleDateString() : "",
      thumbnail:thumbs(s.thumbnails), videoThumbnails:thumbs(s.thumbnails),
      viewCount:Number(st.viewCount||0), likeCount:Number(st.likeCount||0),
      lengthText:durationText(cd.duration), lengthSeconds:seconds(cd.duration),
      allowRatings:true, isUnlisted:false, category:"",
      channelThumbnail:[{url:""},{url:""},{url:""}],
      subscriberCount:0, subscriberCountText:""
    };
  }

  function searchResult(x) {
    const s=x.snippet||{}, id=x.id||{};
    if (id.kind === "youtube#channel") return {
      type:"channel", channelId:id.channelId, channelTitle:s.title, title:s.title,
      author:s.title, authorId:id.channelId, subscriberCount:0,
      thumbnail:thumbs(s.thumbnails), authorThumbnails:thumbs(s.thumbnails),
      description:s.description||""
    };
    if (id.kind === "youtube#playlist") return {
      type:"playlist", playlistId:id.playlistId, title:s.title, author:s.channelTitle||"",
      channelId:s.channelId||"", thumbnail:thumbs(s.thumbnails), videoCount:""
    };
    return videoFrom(x);
  }

  function response(items, nextPageToken) {
    return { data:items, continuation:nextPageToken || "" };
  }

  async function route(url) {
    const u=new URL(url, location.href);
    const p=u.pathname, q=u.searchParams;

    if (/\/api\/v1\/(trending|popular)$/.test(p)) {
      const data=await api("videos",{part:"snippet,contentDetails,statistics",chart:"mostPopular",regionCode:region,maxResults:24});
      return response(data.items.map(videoFrom), data.nextPageToken);
    }

    if (/\/api\/v1\/search$/.test(p)) {
      const query=q.get("q")||"";
      const page=q.get("page")||"";
      const data=await api("search",{part:"snippet",q:query,type:"video",maxResults:25,pageToken:page});
      return response(data.items.map(searchResult), data.nextPageToken);
    }

    let m=p.match(/\/api\/v1\/videos\/([^/]+)$/);
    if (m) {
      const data=await api("videos",{part:"snippet,contentDetails,statistics,status,liveStreamingDetails",id:m[1]});
      if (!data.items.length) return {error:"Video not found"};
      const v=videoFrom(data.items[0]);
      v.relatedVideos={data:[]};
      try {
        const rel=await api("search",{part:"snippet",channelId:v.channelId,type:"video",order:"date",maxResults:10});
        v.relatedVideos.data=rel.items.map(searchResult);
      } catch (_) {}
      return v;
    }

    m=p.match(/\/api\/v1\/channels\/([^/]+)\/videos$/);
    if (m) {
      const ch=await api("channels",{part:"contentDetails,snippet,statistics",id:m[1]});
      const uploads=ch.items[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) return response([]);
      const data=await api("playlistItems",{part:"snippet,contentDetails",playlistId:uploads,maxResults:25,pageToken:q.get("continuation")||""});
      return response(data.items.map(x=>videoFrom({id:x.contentDetails.videoId,snippet:x.snippet})),data.nextPageToken);
    }

    if ((p.endsWith("/channel/home") || p.endsWith("/channel/about")) && q.get("id")) { return await route(location.origin + "/api/v1/channels/" + q.get("id")); }\n\n    m=p.match(/\/api\/v1\/channels\/([^/]+)$/);
    if (m) {
      const ch=await api("channels",{part:"snippet,contentDetails,statistics",id:m[1]});
      const x=ch.items[0]; if(!x) return {error:"Channel not found"};
      const s=x.snippet||{}, st=x.statistics||{};
      const uploads=x.contentDetails?.relatedPlaylists?.uploads;
      let videos=[];
      if (uploads) {
        try {
          const v=await api("playlistItems",{part:"snippet,contentDetails",playlistId:uploads,maxResults:12});
          videos=v.items.map(y=>videoFrom({id:y.contentDetails.videoId,snippet:y.snippet}));
        } catch (_) {}
      }
      return {
        meta:{
          channelId:x.id,title:s.title||"",description:s.description||"",
          subscriberCount:Number(st.subscriberCount||0),viewCount:Number(st.viewCount||0),
          avatar:thumbs(s.thumbnails),banner:[],
          tabs:["Home","Videos","Playlists"]
        },
        subCount:Number(st.subscriberCount||0),data:videos,
        items:[],playlists:[]
      };
    }

    if (/\/channel\//.test(p) && q.get("id")) {
      const chId=q.get("id");
      const ch=await api("channels",{part:"contentDetails",id:chId});
      const uploads=ch.items[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) return response([]);
      const data=await api("playlistItems",{part:"snippet,contentDetails",playlistId:uploads,maxResults:25,pageToken:q.get("token")||""});
      return response(data.items.map(x=>videoFrom({id:x.contentDetails.videoId,snippet:x.snippet})),data.nextPageToken);
    }

    if (/\/noKey\/channels$/.test(p) && q.get("id")) {
      return await route(location.origin + "/api/v1/channels/" + q.get("id"));
    }
    if (/\/noKey\/channelSections$/.test(p)) return {items:[]};

    m=p.match(/\/api\/v1\/playlists\/([^/]+)$/);
    if (m) {
      const pl=await api("playlists",{part:"snippet,contentDetails",id:m[1]});
      const x=pl.items[0]; if(!x) return {error:"Playlist not found"};
      const data=await api("playlistItems",{part:"snippet,contentDetails",playlistId:m[1],maxResults:50,pageToken:q.get("continuation")||""});
      return {
        title:x.snippet?.title||"",author:x.snippet?.channelTitle||"",
        authorUrl:"/channel/"+(x.snippet?.channelId||""),description:x.snippet?.description||"",
        videoCount:x.contentDetails?.itemCount||0,
        videos:data.items.map(y=>videoFrom({id:y.contentDetails.videoId,snippet:y.snippet})),
        continuation:data.nextPageToken||""
      };
    }

    return null;
  }

  window.YTM13YouTubeAPI = { api, route, videoFrom, searchResult };

  const NativeXHR=window.XMLHttpRequest;
  window.XMLHttpRequest=function(){
    const xhr=new NativeXHR(), originalOpen=xhr.open.bind(xhr), originalSend=xhr.send.bind(xhr);
    let intercepted=false, requestUrl="";
    xhr.open=function(method,url,async,user,password){
      requestUrl=String(url);
      intercepted=/\/api\/v1\//.test(requestUrl) || /yt-api\.p\.rapidapi\.com/.test(requestUrl) || /yt\.lemnoslife\.com/.test(requestUrl);
      if (!intercepted) return originalOpen(method,url,async,user,password);
      this._ytm13Intercepted=true;
      this._ytm13Method=method;
      this._ytm13URL=requestUrl;
      this.readyState=1;
    };
    xhr.setRequestHeader=function(name,value){ if(!intercepted) return NativeXHR.prototype.setRequestHeader.call(xhr,name,value); };
    xhr.send=function(body){
      if(!intercepted) return originalSend(body);
      route(requestUrl).then(data=>{
        const text=JSON.stringify(data);
        Object.defineProperty(xhr,"status",{configurable:true,value:200});
        Object.defineProperty(xhr,"responseText",{configurable:true,value:text});
        Object.defineProperty(xhr,"response",{configurable:true,value:text});
        Object.defineProperty(xhr,"readyState",{configurable:true,value:4});
        if(typeof xhr.onload==="function") xhr.onload.call(xhr);
        if(typeof xhr.onreadystatechange==="function") xhr.onreadystatechange.call(xhr);
      }).catch(err=>{
        Object.defineProperty(xhr,"status",{configurable:true,value:500});
        Object.defineProperty(xhr,"responseText",{configurable:true,value:JSON.stringify({error:err.message})});
        Object.defineProperty(xhr,"response",{configurable:true,value:JSON.stringify({error:err.message})});
        Object.defineProperty(xhr,"readyState",{configurable:true,value:4});
        if(typeof xhr.onerror==="function") xhr.onerror.call(xhr,err);
      });
    };
    return xhr;
  };
  window.XMLHttpRequest.prototype=NativeXHR.prototype;

  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    const u=typeof input==="string"?input:(input&&input.url)||"";
    if (/\/api\/v1\//.test(u) || /invidious\./.test(u) || /yt-api\.p\.rapidapi\.com/.test(u)) {
      return route(u).then(data=>new Response(JSON.stringify(data),{status:200,headers:{"Content-Type":"application/json"}}));
    }
    return nativeFetch(input,init);
  };
})();