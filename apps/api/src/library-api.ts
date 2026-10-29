import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { authenticate } from './service';
import * as library from './library';
import * as communities from './communities';
import * as statistics from './library-statistics';
const uid = (r: Request) => authenticate(r.cookies?.survey_session);
@Controller('api')
export class LibraryApi {
  @Get('users') async userByName(@Req() r: Request, @Query('username') username: any) {
    await uid(r);
    return communities.lookupUsername(username);
  }
  @Get('users/:id') async user(@Req() r: Request, @Param('id') id: string) {
    await uid(r);
    return communities.lookupUser(id);
  }
  @Post('questions') async create(@Req() r: Request, @Body() b: any = {}) {
    return library.createQuestion(await uid(r), b);
  }
  @Get('questions') async list(@Req() r: Request, @Query() q: any) {
    return library.listQuestions(await uid(r), q);
  }
  @Get('questions/:id') async detail(
    @Req() r: Request,
    @Param('id') id: string,
    @Query('versionId') v?: string,
  ) {
    return library.questionDetail(id, await uid(r), v);
  }
  @Get('questions/:id/versions') async versions(
    @Req() r: Request,
    @Param('id') id: string,
    @Query('page') p: any,
  ) {
    return library.versionHistory(id, await uid(r), p);
  }
  @Put('questions/:id') async edit(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return library.editQuestion(id, await uid(r), b);
  }
  @Post('questions/:id/restore') async restore(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return library.editQuestion(id, await uid(r), b, true);
  }
  @Post('questions/:id/copy') async copy(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return library.copyQuestion(id, await uid(r), b);
  }
  @Post('questions/:id/save-as') async saveAs(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return library.saveQuestionAs(id, await uid(r), b);
  }
  @Post('questions/:id/shares') async share(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return library.createShare(id, await uid(r), b);
  }
  @Get('questions/:id/usage') async usage(
    @Req() r: Request,
    @Param('id') id: string,
    @Query() q: any,
  ) {
    return statistics.questionUsage(id, q.versionId, await uid(r), q);
  }
  @Get('questions/:id/statistics') async stats(
    @Req() r: Request,
    @Param('id') id: string,
    @Query() q: any,
  ) {
    return statistics.crossStatistics(id, q.versionId, await uid(r), q);
  }
  @Get('deliveries') async inbox(@Req() r: Request, @Query() q: any) {
    return library.shareList(await uid(r), q, 'delivery');
  }
  @Get('square') async square(@Req() r: Request, @Query() q: any) {
    return library.shareList(await uid(r), q, 'public');
  }
  @Get('shares') async sent(@Req() r: Request, @Query() q: any) {
    return library.sentShares(await uid(r), q);
  }
  @Get('shares/:id') async shared(
    @Req() r: Request,
    @Param('id') id: string,
    @Query('token') token?: string,
  ) {
    return library.shareDetail(id, await uid(r), token);
  }
  @Get('question-links/:token') async link(@Req() r: Request, @Param('token') token: string) {
    return library.linkDetail(token, await uid(r));
  }
  @Post('shares/:id/accept') async accept(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return library.receiveShare(id, await uid(r), false, b?.token);
  }
  @Post('shares/:id/reject') async reject(@Req() r: Request, @Param('id') id: string) {
    return library.receiveShare(id, await uid(r), true);
  }
  @Delete('shares/:id') async revoke(@Req() r: Request, @Param('id') id: string) {
    return library.revokeShare(id, await uid(r));
  }
  @Post('surveys/:id/questions/:instanceId/save-to-library') async saveQuestion(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('instanceId') instanceId: string,
    @Body() b: any = {},
  ) {
    return library.saveSurveyQuestion(id, instanceId, await uid(r), b);
  }
  @Post('surveys/:id/library-instances') async attach(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return library.attachQuestion(id, await uid(r), b);
  }
  @Get('surveys/:id/question-upgrades') async upgrades(@Req() r: Request, @Param('id') id: string) {
    return library.upgradeInfo(id, await uid(r));
  }
  @Post('surveys/:id/instances/:instanceId/upgrade') async upgrade(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('instanceId') instanceId: string,
    @Body() b: any = {},
  ) {
    return library.changeInstance(id, instanceId, await uid(r), b);
  }
  @Post('surveys/:id/instances/:instanceId/detach') async detach(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('instanceId') instanceId: string,
    @Body() b: any = {},
  ) {
    return library.changeInstance(id, instanceId, await uid(r), b, true);
  }
  @Post('communities') async community(@Req() r: Request, @Body() b: any = {}) {
    return communities.createCommunity(await uid(r), b.name);
  }
  @Get('communities') async communities(@Req() r: Request, @Query('page') p: any) {
    return communities.listCommunities(await uid(r), p);
  }
  @Get('communities/:id/overview') async overview(@Req() r: Request, @Param('id') id: string) {
    return communities.communityOverview(id, await uid(r));
  }
  @Get('communities/:id/members') async members(
    @Req() r: Request,
    @Param('id') id: string,
    @Query('page') p: any,
  ) {
    return communities.members(id, await uid(r), p);
  }
  @Post('communities/:id/invitations') async invite(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return communities.invite(id, await uid(r), b.recipientId);
  }
  @Get('community-invitations/pending-count') async pending(@Req() r: Request) {
    return communities.pendingInvitations(await uid(r));
  }
  @Get('community-invitations') async invitations(@Req() r: Request, @Query('page') p: any) {
    return communities.invitationList(await uid(r), p);
  }
  @Post('community-invitations/:id/accept') async join(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return communities.respondInvitation(id, await uid(r), 'accept', b.revision);
  }
  @Post('community-invitations/:id/reject') async decline(
    @Req() r: Request,
    @Param('id') id: string,
    @Body() b: any = {},
  ) {
    return communities.respondInvitation(id, await uid(r), 'reject', b.revision);
  }
  @Post('communities/:id/leave') async leave(@Req() r: Request, @Param('id') id: string) {
    return communities.leave(id, await uid(r));
  }
  @Delete('communities/:id/members/:userId') async remove(
    @Req() r: Request,
    @Param('id') id: string,
    @Param('userId') target: string,
  ) {
    return communities.leave(id, await uid(r), target);
  }
}
