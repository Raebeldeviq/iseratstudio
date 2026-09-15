import { assertRegression85Campaign, canonicalRegression85Json } from './regression-85-repair-scope.mjs';

const SCOPE = 'abcf59c654f573bc13906e555badeb13e090eb67d9c971cfb0216b5a4abace58';
const EVIDENCE = 'aed402ff8661fcafe70bddd15cd9abebd1e7f5a5cbf86fb506e0613e34654602';
const CLASSIFICATION = '97569eac0bc46176b3975d5687d48903547e0ebb29cd2dea858c277c69852e80';
const equal = (a,b) => canonicalRegression85Json(a) === canonicalRegression85Json(b);
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

// Pure, previewable repair. It cannot contact a provider or modify a ledger.
export function planCatalogLifecycleRepair(input, evidence, now) {
  const state = structuredClone(input);
  const changes = [];
  const unresolved = [];
  for (const project of state.projects || []) {
    const groups = new Map();
    for (const listing of project.listings || []) groups.set(listing.id,[...(groups.get(listing.id)||[]),listing]);
    project.listings = [...groups].map(([id, copies]) => {
      if (copies.length === 1) return copies[0];
      if (copies.every(copy => equal(copy,copies[0]))) {
        changes.push({kind:'duplicate_removed',projectId:project.id,listingId:id,count:copies.length-1});
        return copies[0];
      }
      const originals = copies.filter(copy => copy.listingOrigin === 'rotation-copy' && copy.rotationSourceListingId);
      const core = ['id','externalId','templateId','version','price','texts','projectingSettings'];
      if (originals.length !== 1 || copies.some(copy => core.some(key => !equal(copy[key],originals[0][key])))) {
        throw new Error(`CATALOG_DUPLICATE_NOT_RECONCILABLE: ${id}`);
      }
      changes.push({kind:'duplicate_removed',projectId:project.id,listingId:id,count:copies.length-1});
      return originals[0];
    });
  }

  const jobs = evidence.productionDelete?.jobs || [];
  const proofs = new Map();
  for (const job of jobs) {
    if (job.status !== 'delete_confirmed') continue;
    if (!job.projectId || !job.sourceListingId || !job.externalObjectNumber || !job.reportMessageId
      || !/^[a-f0-9]{64}$/.test(job.reportHash || '') || !validTime(job.confirmedAt) || !validTime(job.providerProcessedAt)) {
      throw new Error('CATALOG_DELETE_EVIDENCE_INCOMPLETE');
    }
    const key=job.projectId+':'+job.sourceListingId;
    if(proofs.has(key)) throw new Error('CATALOG_DELETE_EVIDENCE_AMBIGUOUS');
    proofs.set(key,{externalId:job.externalObjectNumber,at:job.confirmedAt,reference:job.deleteJobId,kind:'existing_positive_delete_ledger'});
  }

  const campaign = evidence.campaign;
  const audit = evidence.manualAudit;
  if (campaign || audit) {
    if (campaign) assertRegression85Campaign(campaign);
    if (!campaign || !audit || campaign.scopeHash!==SCOPE || campaign.scopeEvidenceHash!==EVIDENCE
      || audit.scopeHash!==SCOPE || audit.scopeEvidenceHash!==EVIDENCE || audit.classificationFingerprint!==CLASSIFICATION
      || !equal(audit.evidence,evidence.originalManualInventory)
      || campaign.manualReconciliationClosure?.evidenceHash!==audit.evidenceHash
      || audit.evidence?.channel!=='immoprofessional-read-only-full-object-list'
      || !validTime(audit.observedAt) || !validTime(audit.completedAt)) throw new Error('CATALOG_MANUAL_EVIDENCE_MISMATCH');
    for (const item of campaign.scope.items) {
      const progress=campaign.progress.find(p=>p.scopeItemId===item.scopeItemId);
      if(progress?.repairState==='manual_external_cleanup_reconciled') {
        if(progress.stage!=='repair_completed' || progress.manualReconciliation?.targetPresence!=='absent'
          || progress.manualReconciliation?.evidenceHash!==audit.evidenceHash
          || audit.evidence.relevantPresentObjectNumbers.includes(item.regressionExternalId)) throw new Error('CATALOG_MANUAL_COMPLETION_INVALID');
        const key=item.projectId+':'+item.regressionListingId;
        if(!proofs.has(key)) proofs.set(key,{externalId:item.regressionExternalId,at:audit.completedAt,reference:audit.evidenceHash,kind:'existing_manual_absence_reconciliation'});
      }
      const project=state.projects.find(p=>p.id===item.projectId);
      if(!project?.listings.some(l=>l.id===item.originalSourceListingId)
        && !jobs.some(j=>j.projectId===item.projectId && j.sourceListingId===item.originalSourceListingId && j.status==='delete_confirmed')) {
        unresolved.push({kind:'original_listing_missing',projectId:item.projectId,listingId:item.originalSourceListingId});
      }
      if(progress?.repairState==='manual_reconciliation_exception_present') {
        unresolved.push({kind:'documented_present_exception',projectId:item.projectId,listingId:item.regressionListingId,externalId:item.regressionExternalId});
      }
    }
  }

  for(const project of state.projects || []) {
    for(const listing of project.listings) {
      const proof=proofs.get(project.id+':'+listing.id);
      if(!proof) continue;
      if(listing.externalId!==proof.externalId || (listing.importConfirmedAt && Date.parse(listing.importConfirmedAt)>Date.parse(proof.at))) throw new Error('CATALOG_DELETE_IDENTITY_OR_TIME_CONFLICT');
      if(listing.status!=='deleted') {
        changes.push({kind:'confirmed_deleted_restored',projectId:project.id,listingId:listing.id,externalId:listing.externalId,proof:proof.kind});
        Object.assign(listing,{status:'deleted',statusMessage:'Bestätigte historische Löschung wiederhergestellt',externalDeletionPending:false,productionDeleteState:'confirmed',deletedAt:proof.at,
          catalogReconciliation:{at:now,reference:proof.reference,source:proof.kind,externalMutation:false}});
      }
    }
    const byId=new Map(project.listings.map(l=>[l.id,l]));
    if(project.listingGroup) {
      project.listingGroup.variants=project.listingGroup.variants.map(v=>{
        const listing=byId.get(v.listing?.id);
        return listing?{...v,listing,...(['deleted','archived'].includes(listing.status)?{active:false}: {})}:v;
      });
      project.listingGroup.listingControls=project.listingGroup.listingControls.map(control=>{
        const listing=byId.get(control.listingId);
        if(listing?.status!=='deleted') return control;
        if(control.processLease || control.schedulerSelectionId || control.pendingRotationListingId) throw new Error('CATALOG_ACTIVE_CONTROL_ON_DELETED_LISTING');
        return {...control,status:'deleted',automaticUpdateEnabled:false,statusMessage:listing.statusMessage};
      });
      project.selectedHouseIds=project.listingGroup.variants.filter(v=>v.active && v.templateId).map(v=>v.templateId);
    }
  }
  state.catalogIntegrityRevision=1;
  state.catalogRepairReview={unresolved,automaticProductionAllowed:unresolved.length===0};
  return {state,changes,unresolved,summary:{duplicatesRemoved:changes.filter(c=>c.kind==='duplicate_removed').reduce((a,c)=>a+c.count,0),deletedRestored:changes.filter(c=>c.kind==='confirmed_deleted_restored').length,unresolved:unresolved.length}};
}
