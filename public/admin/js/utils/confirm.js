const Confirm = {
  ask(title, msg, onOk) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    
    const old = document.getElementById('confirm-btn');
    const btn = old.cloneNode(true);
    old.parentNode.replaceChild(btn, old);
    
    btn.onclick = () => {
      onOk();
      Modal.close('confirm');
    };
    Modal.open('confirm');
  }
};
