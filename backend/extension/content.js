let lastUrl = location.href;

new MutationObserver(()=>{
    const currentUrl = location.href;
    if(currentUrl != lastUrl){
        lastUrl = currentUrl;
        if(currentUrl.includes("/submissions")){
            console.log("Submission page detected");
            observeSubmissionStatus();
        }
    }
}).observe(document,{childList:true,subtree:true});

async function observeSubmissionStatus() {
    const slug = window.location.pathname.split("/")[2];
    const questionData = await fetchQuestionDetails(slug);
    const container_id = "submission-detail_tab";
    const targetNode = document.getElementById(container_id);
    console.log(targetNode);
    if(!targetNode) return;

    const observer = new MutationObserver(()=>{
        const statusDiv = targetNode.querySelectorAll("div > div")[1]?.querySelector("div > div");
        console.log(statusDiv)
        if(statusDiv){
            const statusText = statusDiv.textContent.trim();
            console.log("Submission Status :",statusText);

            if(statusText.includes("Accepted")){
                const code = extractCode();
                const extension = getLanguageExtension();
                console.log("sending message to background");
                console.log(code);
                chrome.runtime.sendMessage({
                    status:"Accepted",
                    url:location.href,
                    filename:`solution-${Date.now()}`,
                    code:code,
                    title:questionData.title,
                    difficulty:questionData.difficulty,
                    tags:questionData.topicTags,
                    content:questionData.content,
                    extension:extension
                });
            }

            observer.disconnect();
        }
    });

    observer.observe(targetNode,{childList:true,subtree:true});
}

function extractCode() {
    console.log(document.querySelectorAll('code'))
    const codeElement = document.querySelectorAll('code');

    const targetCode = [...codeElement].at(-1);
    if(!targetCode) return null;

    // const lines = [...codeElement.querySelectorAll('div')].map(line=>line.innerText);
    // return lines.join('\n');
    console.log(targetCode)
    return targetCode.innerText;
}

function getLanguageExtension() {
    const possibleLanguages = [
  'Python', 'C++', 'Java', 'JavaScript', 'C', 'C#', 'Go', 'Rust', 'Ruby', 'Kotlin', 'Swift', 'TypeScript', 'PHP','Dart','Scala','Racket','Erlang','Elixir'
];

    const pageText = document.body.innerText.toLowerCase();
    const detectedLanguage = possibleLanguages.find(lang => pageText.includes(lang.toLowerCase()));

    console.log("Detected Language: ", detectedLanguage);

    const languageExtensions = {
  'Python': 'py',
  'C++': 'cpp',
  'Java': 'java',
  'JavaScript': 'js',
  'C': 'c',
  'C#': 'cs',
  'Go': 'go',
  'Rust': 'rs',
  'Ruby': 'rb',
  'Kotlin': 'kt',
  'Swift': 'swift',
  'TypeScript': 'ts',
  'PHP': 'php',
  'Dart': 'dart',
  'Scala': 'scala',
  'Racket': 'rkt',
  'Erlang': 'erl',
  'Elixir': 'ex'
};

    if(!detectedLanguage) return 'txt';
    return languageExtensions[detectedLanguage]; 
}

async function fetchQuestionDetails(slug){
    const query = `query getQuestionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    title
    difficulty
    topicTags {
      name
      slug
    }
    content
    stats
    codeSnippets {
      lang
      langSlug
      code
    }
  }
}`;
    const response = await fetch('https://leetcode.com/graphql',{
        method:"POST",
        headers:{
            "Content-Type":"application/json"
        },
        body:JSON.stringify({
            query,
            variables:{titleSlug:slug}
        })
    });

    const data = await response.json();
    return data.data.question;
}

// Fetching values
// Title, Difficulty level, Topics/Tags,maybe description, code, language