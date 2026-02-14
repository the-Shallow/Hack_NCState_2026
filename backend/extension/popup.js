document.getElementById('authBtn').addEventListener('click',()=>{
    chrome.runtime.sendMessage({action:'startAuth'});
})