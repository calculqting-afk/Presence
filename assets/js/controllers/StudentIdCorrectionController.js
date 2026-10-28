import {PasswordResetApi} from './PasswordResetApi.js';
import {EmailAuthProvider,reauthenticateWithCredential} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {ControllerScope} from '../core/ControllerScope.js';
export class StudentIdCorrectionController {
  constructor({document=globalThis.document,getUser,can,notify,api}){Object.assign(this,{document,getUser,can,notify,api});this.scope=new ControllerScope();this.generation=0;}
  initialize() {
    if(!this.scope.initialize())return;
    this.modal=this.document.querySelector('#studentIdCorrectionModal');this.form=this.document.querySelector('#studentIdCorrectionForm');
    for(const button of this.modal.querySelectorAll('[data-close-student-id]'))this.scope.listen(button,'click',()=>this.close());
    this.scope.listen(this.modal,'click',event=>{if(event.target===this.modal)this.close();});
    this.scope.listen(this.document,'keydown',event=>{
      if(this.modal.hidden)return;
      if(event.key==='Escape')this.close();
      if(event.key==='Tab'){
        const controls=[...this.modal.querySelectorAll('button,input,textarea')].filter(node=>!node.disabled&&!node.closest('[hidden]'));
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&this.document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&this.document.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    this.scope.listen(this.form,'submit',event=>{event.preventDefault();void this.preview();});
    for(const selector of ['#correctedStudentId','#studentIdCorrectionReason'])this.scope.listen(this.document.querySelector(selector),'input',()=>this.clearPreview());
    this.scope.listen(this.document.querySelector('#confirmStudentIdCorrection'),'click',()=>void this.confirm());
  }
  field(id){return this.document.querySelector('#'+id);}
  message(text){this.field('studentIdCorrectionStatus').textContent=text;}
  clearPreview(){this.plan=null;this.field('studentIdPreview').hidden=true;this.field('studentIdAdminPassword').value='';this.field('studentIdConfirmValue').value='';}
  editing(disabled){for(const id of ['correctedStudentId','studentIdCorrectionReason'])this.field(id).disabled=disabled;}
  async open(student,trigger) {
    if(!this.can('correctStudentId')||this.busy||!student)return;
    const generation=++this.generation;this.api ||= new PasswordResetApi();
    this.student=student;this.trigger=trigger;this.form.reset();this.clearPreview();this.modal.hidden=false;
    this.field('studentIdCorrectionName').textContent=`${[student.firstName,student.middleName,student.lastName].filter(Boolean).join(' ')} · ${student.accountId}`;
    this.field('studentIdCurrentValue').textContent=student.accountId;this.message('Checking for an unfinished correction…');
    this.field('studentIdPreviewButton').disabled=true;
    const uid=student.uid;
    try{
      const result=await this.api.call('/v1/admin/student-id/status',this.getUser(),{studentUid:uid});
      if(this.modal.hidden||generation!==this.generation||this.student?.uid!==uid)return;
      this.student={...student,accountId:result.pending?.oldId||result.currentId};
      this.field('studentIdCurrentValue').textContent=this.student.accountId;
      if(result.pending){this.field('correctedStudentId').value=result.pending.newId;this.field('studentIdCorrectionReason').value=result.pending.reason;this.message('An interrupted correction exists. Preview it and confirm to resume safely.');}
      else this.message('Preview checks availability without changing the account. The password and existing records are preserved.');
    }catch(error){if(!this.modal.hidden&&generation===this.generation)this.message(error.message);}
    finally{if(generation===this.generation){this.field('studentIdPreviewButton').disabled=false;this.field('correctedStudentId').focus();}}
  }
  async preview() {
    if(this.busy||!this.student||!this.can('correctStudentId'))return;
    this.busy=true;this.editing(true);this.field('studentIdPreviewButton').disabled=true;this.clearPreview();this.message('Checking IDs and login account…');
    const student=this.student;
    try {
      const result=await this.api.call('/v1/admin/student-id/preview',this.getUser(),{studentUid:student.uid,oldId:student.accountId,
        newId:this.field('correctedStudentId').value.trim(),reason:this.field('studentIdCorrectionReason').value.trim()});
      if(!this.scope.initialized||this.student?.uid!==student.uid)return;
      this.plan=result;this.field('studentIdPreview').hidden=false;
      this.field('studentIdPreviewName').textContent=result.studentName;
      this.field('studentIdPreviewOld').textContent=result.oldId;this.field('studentIdPreviewNew').textContent=result.newId;
      this.field('confirmStudentIdCorrection').disabled=result.completed;
      this.field('confirmStudentIdCorrection').textContent=result.resume?'Resume correction':'Confirm correction';
      this.message(result.completed?'This correction was already completed and verified.':`Review the student and IDs. Enter your admin password and type ${result.newId} to ${result.resume?'resume':'confirm'}.`);
      if(!result.completed)this.field('studentIdAdminPassword').focus();
    }catch(error){this.message(error.message);}
    finally{this.busy=false;this.editing(false);this.field('studentIdPreviewButton').disabled=false;}
  }
  async confirm() {
    if(this.busy||!this.plan||this.plan.completed||!this.can('correctStudentId'))return;
    if(this.field('studentIdConfirmValue').value!==this.plan.newId){this.message('Type the corrected ID exactly as shown in the preview.');return;}
    const password=this.field('studentIdAdminPassword').value;if(!password){this.message('Enter your own admin password.');return;}
    this.busy=true;this.editing(true);this.field('confirmStudentIdCorrection').disabled=true;this.message('Confirming your identity and saving the correction…');
    try{
      const user=this.getUser();await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,password));
      this.field('studentIdAdminPassword').value='';
      const result=await this.api.call('/v1/admin/student-id/confirm',user,{preview:this.plan.preview,signature:this.plan.signature,confirmId:this.field('studentIdConfirmValue').value});
      this.plan.completed=true;this.message(`Verified: ${result.oldId} → ${result.newId}. The student can sign in with the new ID and the same password.`);
      this.notify('Student ID corrected','The login ID was verified. Attendance, fines, face registration and the password were preserved.');
    }catch(error){this.message(error.code?.startsWith('auth/')?'Your admin password could not be verified.':error.message);}
    finally{this.busy=false;this.editing(false);this.field('studentIdAdminPassword').value='';this.field('confirmStudentIdCorrection').disabled=Boolean(this.plan?.completed);}
  }
  close(){if(this.busy)return;this.generation++;this.modal.hidden=true;this.form.reset();this.clearPreview();this.student=null;this.trigger?.focus();}
  dispose(){this.generation++;this.scope.dispose();this.field('studentIdAdminPassword').value='';this.plan=null;}
}
