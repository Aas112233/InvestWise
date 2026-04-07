import { Member } from '../types';

type MemberReference =
 | string
 | {
   _id?: string;
   id?: string;
   memberId?: string;
   name?: string;
  }
 | null
 | undefined;

export const resolveMemberIdentity = (memberRef: MemberReference, members: Member[]) => {
 const populatedMember = memberRef && typeof memberRef === 'object' ? memberRef : null;
 const rawId = typeof memberRef === 'string' ? memberRef : populatedMember?._id || populatedMember?.id || '';
 const matchedMember = members.find(member => member.id === rawId || member.memberId === rawId || member.memberId === populatedMember?.memberId);

 return {
  memberMongoId: matchedMember?.id || rawId,
  memberDisplayId: populatedMember?.memberId || matchedMember?.memberId || 'N/A',
  memberName: populatedMember?.name || matchedMember?.name || 'Unknown'
 };
};
