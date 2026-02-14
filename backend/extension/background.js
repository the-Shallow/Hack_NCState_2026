const CLIENT_ID = "Ov23liZL9Kiq6pk9zkO3";
let deviceCode = null;

chrome.runtime.onMessage.addListener( async (msg,sender,sendResponse)=>{
    if(msg.action == 'startAuth'){
        console.log(startGithubOAuth());
    }else if(msg.status == 'Accepted'){
        console.log("Accepted Submission detected on URL :",msg.url);
        const title = msg.title;
        const difficulty = msg.difficulty;
        const tags = msg.tags;
        const content = msg.content;
        const code = msg.code;
        const extension = msg.extension;
        const question_store = await store_question({title,difficulty,content,tags});
        if(question_store.status && question_store.problem_id){
            const problem_id = question_store.problem_id
            const files = getGithubFiles({title,difficulty,tags,content,code,extension});
            console.log( (await chrome.storage.local.get(["githubToken"])).githubToken );
            const user = (await chrome.storage.local.get(["user"])).user;
            const repo = 'leetcode-submissions';
            const username = 'the-Shallow';
            const branch = 'main';
            console.log(code)
            console.log(files)
            uploadCodeToRepo(
                {token :(await chrome.storage.local.get(["githubToken"])).githubToken,username,repo,branch,files,problem_id,extension,user}
            );
        }
    }
});


chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    if(msg.action == 'startAuth'){
        startDeviceFlow();
    }
});

async function startDeviceFlow() {
    const res = await fetch('https://github.com/login/device/code',{
        method:"POST",
        headers:{
            "Content-Type":"application/x-www-form-urlencoded"
        },
        body:new URLSearchParams({
            client_id:CLIENT_ID,
            scope:'repo'
        })
    });

    const data = await res.text();
    console.log(data);
    const params = new URLSearchParams(data);
    deviceCode = params.get('device_code');


    chrome.notifications.create('github-auth',{
        type:'basic',
        iconUrl:'https://img.icons8.com/?size=100&id=12599&format=png&color=000000',
        title:'Github Authentication',
        message:`Go to ${params.get('verification_uri')} and enter code : ${params.get('user_code')}`
    });

    chrome.notifications.onClicked.addListener((notificationId)=>{
        console.log(notificationId);
        if(notificationId == "github-auth"){
            const verificationUrl = params.get('verification_uri');
            if(verificationUrl){
                chrome.tabs.create({url:verificationUrl})
                chrome.tabs.create({url:`user_code.html?code=${encodeURIComponent(params.get('user_code'))}`});
            }
        }
    })

    return pollForAccessToken(params.get('device_code'),params.get('interval')+5);
}

async function startGithubOAuth() {
    const redirectUri = chrome.identity.getRedirectURL();
    console.log(chrome.identity.getRedirectURL());
    const authURL = `https://github.com/login/oauth/authorize` +
        `?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent("repo user")}`;

    const redirectURL = await new Promise((resolve, reject)=> {
        chrome.identity.launchWebAuthFlow(
            {url: authURL, interactive: true},
            (url) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError));
                if (!url) return reject(new Error("No redirect URL"));
                resolve(url);
            }
        )
    });

    const url = new URL(redirectURL);
    const code = url.searchParams.get("code");
    if(!code) throw new Error("No code found in redirect URL");

    const res = await fetch(`http://localhost:8000/users/github/exchange`, {
        method:"POST",
        headers:{
            "Content-Type": "application/json"
        },
        body: JSON.stringify({code, redirect_uri: redirectUri}),
    });

    const data = await res.json();
    if (!res.ok) {
        console.error("Failed to exchange code", data);
        return
    }

    await chrome.storage.local.set({githubToken:data.access_token});
    await chrome.storage.local.set({user: data.user});

    console.log("Github Connected:", data.github?.login, "user",data.user);
    
}

async function store_question(problem){
    console.log(problem)
    const res = await fetch('http://localhost:8000/problems/',{
        method:"POST",
        headers:{
            "Content-Type":"application/json"
        },
        body:JSON.stringify({
            title:problem.title,
            description:problem.content,
            difficulty:problem.difficulty,
            tags:problem.tags
        })
    });

    const data = await res.json();
    console.log(data,res);

    if(res.status && res.status == 201){
        return {
            problem_id:data.problem_id,
            status:true
        }
    }

    return {status:false};
}

async function pollForAccessToken(code,interval){
    const POLL_URL = "https://github.com/login/oauth/access_token";
    const POLL_BODY = new URLSearchParams({
        client_id:CLIENT_ID,
        device_code:code,
        grant_type:'urn:ietf:params:oauth:grant-type:device_code'
    });

    const poll = setInterval(async ()=> {
        const res = await fetch(POLL_URL,{
            method:"POST",
            headers:{
                "Content-Type":"application/x-www-form-urlencoded",
                "Accept":"application/json"
            },
            body:POLL_BODY
        });

        const data = await res.json();
        console.log(data);

        if(data.access_token){
            clearInterval(poll);
            console.log("Guthub Access Token:", data.access_token);
            chrome.storage.local.set({githubToken:data.access_token});

            const github_data = await fetch("https://api.github.com/user",{
                method:"GET",
                headers:{
                    "Content-Type":"application/x-www-form-urlencoded",
                    "Accept":"application/json",
                    "Authorization":`Bearer ${data.access_token}`
                },
            });

            const github_res = await github_data.json();
            // console.log(github_res)
            console.log({
                        github_id:github_res.id,
                        login:github_res.login,
                        email:github_res.email,
                        name:github_res.name,
                        bio:github_res.bio
                    })
            if(github_res){
                const user_res = await fetch("http://localhost:8000/users/",{
                    method:"POST",
                    headers:{
                        "Content-Type":"application/json",
                    },
                    body:JSON.stringify({
                        github_id:String(github_res.id),
                        login:github_res.login,
                        email:github_res.email,
                        name:github_res.name,
                        bio:github_res.bio
                    })
                });

                const user_data = await user_res.json();
                console.log(user_data);
                chrome.storage.local.set({user:user_data});
                if (user_res && (user_res.status == 201 || user_res.status == 200)){
                    console.log(user_data.message)
                    return true;
                }else{
                    console.error(user_data.content)
                    return false;
                }
            }


        }else if(data.error && data.error != 'authorization_pending'){
            clearInterval(poll);
            console.error("Github Auth Error:",data);
        }
    },interval * 1000);
}

function getGithubAccessToken(callback){
    const CLIENT_SECRET = 'batman'
    const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;

    const authURL = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=repo`;

    chrome.identity.launchWebAuthFlow(
        {url:authURL, interactive:true},
        function(redirectURL){
            if(chrome.runtime.lastError || !redirectURL){
                console.error("OAuth Error: ",chrome.runtime.lastError);
                return;
            }

            const url = new URL(redirectURL);
            const code = url.searchParams.get('code');

            fetch('https://github.com/login/oauth/access_token',{
                method:'POST',
                headers:{
                    Accept:"application/json",
                    "Content-Type":"application/json"
                },
                body:JSON.stringify({
                    client_id:CLIENT_ID,
                    client_secret:CLIENT_SECRET,
                    code,
                    redirect_url:REDIRECT_URI
                })
            }).then(res => res.json())
            .then(data=>{
                if(data.access_token){
                    chrome.storage.local.set({github_token:data.access_token});
                    callback(data.access_token);
                }else{
                    console.error("No token received: ",data);
                }
            });
        }
    );
}

async function uploadCodeToRepo({token,username,repo,branch,files,problem_id,extension,user}){
    console.log(token,username,repo,branch);
    const baseURL = `https://api.github.com/repos/${username}/${repo}/contents`;

    for (const file of [
        {
            path:`${files.folder}/${files.codeFilename}/${files.codeFilename}`,
            content:files.codeContent,
            message:`Add Solution : ${files.codeFilename}`,
            raw_code:files.rawCode,
            is_code_file:true
        },
        {
            path:`${files.folder}/${files.codeFilename}/${files.readmeFilename}`,
            content:files.readmeContent,
            message:`Add Solution : ${files.codeFilename}`,
            raw_code:undefined,
            is_code_file:false
        }
    ])
    {
        const url = `${baseURL}/${file.path}`;
        const existing = await fetch(url,
            {
            method:"GET",
            headers:{
                Authorization:`token ${token}`,
            }
        }
        );

        const temp = await existing.json()
        console.log(temp);
        let sha = null;
        if(temp != null){
            sha = temp.sha
        }
            const res = await fetch(url,{
            method:"PUT",
            headers:{
                Authorization:`token ${token}`,
                "Content-Type":"applicaton/json"
            },
            body:JSON.stringify({
                message:file.message,
                content:file.content,
                branch:branch,
                sha:sha
            }),
        });

        const data = await res.json();

        if(!res.ok){
            console.error(`Failed to upload ${file.path}:`,data);
        }else {
            console.log(`Uploaded ${file.path}`);
            if(file.is_code_file) {
                console.log(file)
                console.log({
                        "problem_id":problem_id,
                        "user_id":user.user_id,
                        "code":file.raw_code,
                        "title":files.codeFilename,
                        "language":extension
                    });
                const codeUpload = await fetch(`http://localhost:8000/submissions`,
                {
                    method:"POST",
                    headers:{
                        "Content-Type":"application/json"
                    },
                    body:JSON.stringify({
                        "problem_id":problem_id,
                        "user_id":user.user_id,
                        "code":file.raw_code,
                        "title":files.codeFilename,
                        "language":extension
                    }),
                }
            );

                const codeUploadRes = await codeUpload.json();
                console.log(codeUploadRes)
                if(codeUploadRes && codeUploadRes.status == 201){
                    console.log(codeUploadRes.error)
                }else{
                    console.log(codeUploadRes.message)
                }

            }
        }
    }
}

function getGithubFiles({title, difficulty, tags, content, code, extension}){
    const folder = difficulty.toLowerCase();
    const fileSafeTitle = title.toLowerCase().replace(/\s+/g,'-').replace(/[^\w-]/g,'');
    const codeFilename = `${fileSafeTitle}.${extension}`;
    const readmeFilename = `README.md`;

    const readmeContent = `# ${title}
    
    ***Difficulty*:${difficulty}
    **Tags** : ${tags.map(tag=> `\`${tag.name}\``).join(', ')}

    ---

    ${content}
    `;

    return {
        folder,
        codeFilename,
        readmeFilename,
        codeContent: btoa(unescape(encodeURIComponent(code))),
        rawCode:code,
        readmeContent: btoa(unescape(encodeURIComponent(readmeContent))),
    }
}