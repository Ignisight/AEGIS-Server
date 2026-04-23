const Modal = {
  open(id) {
    const el = document.getElementById('modal-' + id);
    if (el) el.classList.remove('hidden');
  },
  close(id) {
    const el = document.getElementById('modal-' + id);
    if (el) el.classList.add('hidden');
  }
};
